'use client'
import {useUi} from "@/i18n/useUi";


import { useEffect, useMemo, useRef, useState } from 'react';
import { useUsers } from '../hooks/useUsers';
import { UserRow } from './UserRow';
import { UserForm } from './UserForm';
import { Button } from '@/components/core/button';
import { UserTableBulkFilterModal } from '@/components/core';
import type { UserFormData } from '../validations/user.schema';
import type { Role } from '@/types';
import { useOrganizations } from '@/features/organizations';
import { roleLabel } from "@/lib/utils/roleLabel";
import { toast } from "sonner";

export const UserTable = ({
  organizationId,
  organizationLabel,
  filterRole,
  inviteRolesOverride,
  title = "Users",
}: {
  organizationId?: string;
  organizationLabel?: string;
  filterRole?: Role;
  inviteRolesOverride?: Role[];
  title?: string;
}) => {
  const ui = useUi();
  const { users, callerRole, isLoading, error, inviteUser, changeUserRole, disableUser, enableUser, assignOrganization, bulkAssignOrganization, sendPasswordSetupLink } = useUsers(organizationId);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const baseUsers = filterRole ? users.filter((u) => u.role === filterRole) : users;
  const canManageOrgs = callerRole === "super_admin" || callerRole === "system_admin";
  const { organizations } = useOrganizations({ enabled: canManageOrgs, includeCounts: false });
  const showOrganizationColumn = callerRole !== "organization_admin";
  const showOrganizationFilter = canManageOrgs && !organizationId;
  const showSelectionColumn = callerRole === "super_admin" || callerRole === "system_admin";

  // Filters (client-side)
  const [roleFilter, setRoleFilter] = useState<Role | "all">(filterRole ?? "all");
  const [orgFilter, setOrgFilter] = useState<string | "all" | "none">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "pending" | "disabled">("all");

  // Bulk selection + bulk move state
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const bulkMode = showSelectionColumn && selectedUserIds.size > 0;
  const [bulkTargetOrgId, setBulkTargetOrgId] = useState<string>("");
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [isBulkApplying, setIsBulkApplying] = useState(false);

  const selectedOrg = (organizations ?? []).find((o) => o.id === orgFilter);
  const selectedOrgIsInactive = !!selectedOrg && selectedOrg.is_active === false;

  const getStatus = (u: { is_active?: boolean | null; onboarding_status?: string | null }) => {
    const enabled = u.is_active !== false;
    if (!enabled) return "disabled" as const;
    if (u.onboarding_status === "pending") return "pending" as const;
    return "active" as const;
  };

  const roleOptions = Array.from(new Set(baseUsers.map((u) => u.role))).sort((a, b) => a.localeCompare(b));

  const orgOptions = (() => {
    // Only show org filter on global users views (admin/system). Org-scoped pages don't need it.
    if (showOrganizationFilter) {
      const opts = (organizations ?? []).map((o) => ({
        id: o.id,
        label: (o.name?.trim()?.length ? o.name : o.slug?.trim()?.length ? o.slug : o.id) + (o.is_active === false ? " (inactive)" : ""),
      }));
      // stable sort by label
      opts.sort((a, b) => a.label.localeCompare(b.label));
      return opts;
    }

    return [];
  })();

  const filteredUsers = baseUsers.filter((u) => {
    if (roleFilter !== "all" && u.role !== roleFilter) return false;

    if (statusFilter !== "all") {
      const s = getStatus(u);
      if (s !== statusFilter) return false;
    }

    if (showOrganizationFilter && orgFilter !== "all") {
      const oid = u.organization_id ?? null;
      if (orgFilter === "none") return oid === null;
      return oid === orgFilter;
    }

    return true;
  });

  const selectableIds = useMemo(() => {
    if (!showSelectionColumn) return [];
    return filteredUsers
      .filter((u) => u.role === "member" || u.role === "organization_admin")
      .map((u) => u.id);
  }, [filteredUsers, showSelectionColumn]);

  const allSelectableSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedUserIds.has(id));
  const someSelectableSelected = selectableIds.some((id) => selectedUserIds.has(id)) && !allSelectableSelected;
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!headerCheckboxRef.current) return;
    headerCheckboxRef.current.indeterminate = someSelectableSelected;
  }, [someSelectableSelected]);

  useEffect(() => {
    // Safety: if caller role changes and selection column is no longer allowed, drop selection.
    if (!showSelectionColumn && selectedUserIds.size > 0) {
      setSelectedUserIds(new Set());
    }
  }, [showSelectionColumn, selectedUserIds.size]);

  const clearAll = () => {
    setSelectedUserIds(new Set());
    setBulkTargetOrgId("");
    setBulkConfirmOpen(false);
    setIsFormOpen(false);
    setRoleFilter(filterRole ?? "all");
    setOrgFilter("all");
    setStatusFilter("all");
  };

  const bulkTargetOrg = (organizations ?? []).find((o) => o.id === bulkTargetOrgId) ?? null;
  const bulkTargetOrgIsInactive = !!bulkTargetOrg && bulkTargetOrg.is_active === false;
  const bulkTargetOrgLabel =
    bulkTargetOrg
      ? (bulkTargetOrg.name?.trim()?.length
          ? bulkTargetOrg.name
          : bulkTargetOrg.slug?.trim()?.length
            ? bulkTargetOrg.slug
            : bulkTargetOrg.id) + (bulkTargetOrg.is_active === false ? " (inactive)" : "")
      : bulkTargetOrgId || "—";

  const handleInviteUser = async (data: UserFormData) => {
    const effectiveOrgId =
      organizationId && (data.role === 'member' || data.role === 'organization_admin')
        ? organizationId
        : data.organization_id ?? null;

    const fullName = typeof data.full_name === "string" ? data.full_name.trim() : "";
    const t = toast.loading(ui("Inviting user…"));
    try {
      const res = await inviteUser(data.email, data.role, effectiveOrgId, fullName.length ? fullName : null);
      toast.success(ui(res.message || "User invited."), { id: t });
      setIsFormOpen(false);
    } catch (e) {
      toast.error(ui(e instanceof Error ? e.message : "Failed to invite user"), { id: t });
    }
  };

  if (isLoading) {
    return <div className="text-center py-8">{ui("Loading users...")}</div>;
  }

  if (error) {
    return <div className="text-red-500 text-center py-8">{ui("Error: ")}{ui(error.message)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-2xl font-bold">{title}</h2>
        <Button
          className="shrink-0"
          onClick={() => setIsFormOpen(true)}
          disabled={!callerRole || (callerRole !== 'super_admin' && callerRole !== 'system_admin' && callerRole !== 'organization_admin')}
        >
          {ui("Invite User")}</Button>
      </div>

      {/* Filters */}
      {!filterRole && (
        <div className="flex flex-col gap-3 rounded-lg border bg-white p-4 shadow-sm md:flex-row md:items-end md:justify-between">
          <div className={`grid grid-cols-1 gap-3 ${showOrganizationFilter ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
            <div>
              <label className="block text-sm font-medium mb-1">{ui("Role")}</label>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter((e.target.value as Role | "all"))}
                className="w-full px-3 py-2 border rounded-md bg-white hover:cursor-pointer disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                disabled={bulkMode}
              >
                <option value="all">{ui("All roles")}</option>
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {ui(roleLabel(r))}
                  </option>
                ))}
              </select>
            </div>

            {showOrganizationFilter ? (
              <div>
                <label className="block text-sm font-medium mb-1">{ui("Organization")}</label>
                <select
                  value={orgFilter}
                  onChange={(e) => setOrgFilter(e.target.value as string | "all" | "none")}
                  className="w-full px-3 py-2 border rounded-md bg-white hover:cursor-pointer disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                  disabled={bulkMode}
                >
                  <option value="all">{ui("All organizations")}</option>
                  <option value="none">{ui("No organization")}</option>
                  {orgOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {orgFilter !== "all" && orgFilter !== "none" && selectedOrgIsInactive ? (
                  <div className="mt-2">
                    <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-700 px-2 py-0.5 text-xs font-medium">
                      {ui("Inactive org")}</span>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div>
              <label className="block text-sm font-medium mb-1">{ui("Status")}</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="w-full px-3 py-2 border rounded-md bg-white hover:cursor-pointer disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                disabled={bulkMode}
              >
                <option value="all">{ui("All statuses")}</option>
                <option value="active">{ui("Active")}</option>
                <option value="pending">{ui("Pending")}</option>
                <option value="disabled">{ui("Disabled")}</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 md:justify-end">
            <Button variant="outline" onClick={clearAll}>
              {ui("Clear")}</Button>
          </div>

        </div>
      )}

      {showSelectionColumn && bulkMode ? (
        <div className="flex flex-col gap-3 rounded-lg border bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="text-sm font-medium">
            {selectedUserIds.size} {ui("selected")}</div>

          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-end">
            <select
              value={bulkTargetOrgId}
              onChange={(e) => setBulkTargetOrgId(e.target.value)}
              className="px-3 py-2 border rounded-md bg-white hover:cursor-pointer disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed"
              disabled={isBulkApplying}
            >
              <option value="">{ui("Select target organization…")}</option>
              {(organizations ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {(o.name?.trim()?.length ? o.name : o.slug?.trim()?.length ? o.slug : o.id) + (o.is_active === false ? ui(" (inactive)") : "")}
                </option>
              ))}
            </select>

            {bulkTargetOrgId && bulkTargetOrgIsInactive ? (
              <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-700 px-2 py-0.5 text-xs font-medium whitespace-nowrap">
                {ui("Inactive org")}</span>
            ) : null}

            <Button variant="outline" onClick={clearAll} disabled={isBulkApplying}>
              {ui("Clear")}</Button>
            <Button
              disabled={!bulkTargetOrgId || isBulkApplying}
              onClick={() => {
                if (!bulkTargetOrgId) return;
                setBulkConfirmOpen(true);
              }}
            >
              {ui("Move selected")}</Button>
          </div>
        </div>
      ) : null}

      {isFormOpen && (
        <div className="border rounded-lg p-4 bg-white shadow">
          <h3 className="text-lg font-semibold mb-4">
            {ui("Invite User")}</h3>
          <UserForm
            initialData={organizationId ? { organization_id: organizationId } : undefined}
            organizationLabel={organizationLabel}
            enableOrgPicker={callerRole !== "organization_admin"}
            allowedRoles={
              inviteRolesOverride ?? (
                callerRole === 'organization_admin'
                  ? ['member']
                  : callerRole === 'system_admin'
                    ? ['organization_admin']
                    : ['system_admin', 'organization_admin', 'member'] // super_admin
              )
            }
            onSubmit={handleInviteUser}
            onCancel={() => {
              setIsFormOpen(false);
            }}
          />
        </div>
      )}

      <div className="border rounded-lg overflow-hidden">
        <div className="w-full overflow-x-auto">
          <table className="min-w-max w-full">
          <thead className="bg-gray-50">
            <tr>
              {showSelectionColumn ? (
                <th className="px-4 py-3 text-left text-sm font-semibold w-10">
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    checked={allSelectableSelected}
                    className="h-4 w-4 rounded border-gray-300 hover:cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      accentColor: "color-mix(in srgb, var(--brand-primary) 95%, transparent)",
                    }}
                    disabled={selectableIds.length === 0}
                    onChange={(e) => {
                      const nextChecked = e.target.checked;
                      setSelectedUserIds((prev) => {
                        const next = new Set(prev);
                        if (nextChecked) {
                          selectableIds.forEach((id) => next.add(id));
                        } else {
                          selectableIds.forEach((id) => next.delete(id));
                        }
                        return next;
                      });
                    }}
                  />
                </th>
              ) : null}
              <th className="px-4 py-3 text-left text-sm font-semibold">{ui("Name")}</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">{ui("Email")}</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">{ui("Role")}</th>
              {showOrganizationColumn ? (
                <th className="px-4 py-3 text-left text-sm font-semibold">{ui("Organization")}</th>
              ) : null}
              <th className="px-4 py-3 text-left text-sm font-semibold">{ui("Status")}</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">{ui("Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length === 0 ? (
              <tr>
                <td
                  colSpan={5 + (showOrganizationColumn ? 1 : 0) + (showSelectionColumn ? 1 : 0)}
                  className="px-4 py-8 text-center text-gray-500"
                >
                  {ui("No users found")}</td>
              </tr>
            ) : (
              filteredUsers.map(user => (
                <UserRow
                  key={user.id}
                  user={user}
                  callerRole={callerRole}
                  organizations={organizations}
                  showOrganizationColumn={showOrganizationColumn}
                  showSelectionColumn={showSelectionColumn}
                  bulkMode={bulkMode}
                  isSelected={selectedUserIds.has(user.id)}
                  canSelect={
                    showSelectionColumn &&
                    (user.role === "member" || user.role === "organization_admin")
                  }
                  onToggleSelect={(userId, nextSelected) => {
                    setSelectedUserIds((prev) => {
                      const next = new Set(prev);
                      if (nextSelected) next.add(userId);
                      else next.delete(userId);
                      return next;
                    });
                  }}
                  onAssignOrganization={async (userId, orgId) => {
                    const res = await assignOrganization(userId, orgId);
                    return { message: res.message };
                  }}
                  onChangeRole={async (userId, newRole) => {
                    const res = await changeUserRole(userId, newRole);
                    return { message: res.message };
                  }}
                  onDisable={async (userId) => {
                    const res = await disableUser(userId);
                    return { message: res.message };
                  }}
                  onEnable={async (userId) => {
                    const res = await enableUser(userId);
                    return { message: res.message };
                  }}
                  onPasswordSetupLink={async (userId) => {
                    const res = await sendPasswordSetupLink(userId);
                    return { message: res.message };
                  }}
                />
              ))
            )}
          </tbody>
          </table>
        </div>
      </div>

      <UserTableBulkFilterModal
        open={bulkConfirmOpen}
        selectedCount={selectedUserIds.size}
        targetOrganizationLabel={bulkTargetOrgLabel}
        targetOrgIsInactive={bulkTargetOrgIsInactive}
        isConfirming={isBulkApplying}
        onCancel={() => {
          if (isBulkApplying) return;
          setBulkConfirmOpen(false);
        }}
        onConfirm={async () => {
          if (!bulkTargetOrgId) return;
          if (selectedUserIds.size === 0) return;

          setIsBulkApplying(true);
          try {
            const ids = Array.from(selectedUserIds);
            const result = await bulkAssignOrganization(ids, bulkTargetOrgId);

            if (result.failureCount === 0) {
              toast.success(ui("Moved {v0} user{v1}.", {v0: result.successCount, v1: ui.locale === "sr-Latn" ? "" : (result.successCount === 1 ? "" : "s")}));
              setSelectedUserIds(new Set());
              setBulkTargetOrgId("");
              setBulkConfirmOpen(false);
              return;
            }

            toast.error(
              ui("Moved {v0} user{v1}. ", {v0: result.successCount, v1: ui.locale === "sr-Latn" ? "" : (result.successCount === 1 ? "" : "s")}) + ui("{v0} failed. The failed users remain selected so you can retry.", {v0: result.failureCount})
            );
            setSelectedUserIds(new Set(result.failures.map((f) => f.userId)));
            setBulkConfirmOpen(false);
          } finally {
            setIsBulkApplying(false);
          }
        }}
      />
    </div>
  );
};

