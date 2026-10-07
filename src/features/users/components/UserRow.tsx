'use client'
import {useUi} from "@/i18n/useUi";


import { Button } from '@/components/core/button';
import type { ApiUser } from '../api/users.api';
import type { Role } from '@/types';
import { useEffect, useState } from 'react';
import type { Organization } from '@/features/organizations';
import { roleLabel } from "@/lib/utils/roleLabel";
import { toast } from "sonner";

interface UserRowProps {
  user: ApiUser;
  callerRole: Role | null;
  organizations?: Organization[];
  showOrganizationColumn?: boolean;
  showSelectionColumn?: boolean;
  isSelected?: boolean;
  canSelect?: boolean;
  onToggleSelect?: (userId: string, nextSelected: boolean) => void;
  bulkMode?: boolean;
  onAssignOrganization?: (userId: string, organizationId: string) => Promise<{ message?: string }>;
  onChangeRole: (userId: string, newRole: Role) => Promise<{ message?: string }>;
  onDisable: (userId: string) => Promise<{ message?: string }>;
  onEnable: (userId: string) => Promise<{ message?: string }>;
  onPasswordSetupLink: (userId: string) => Promise<{ message?: string }>;
}

export const UserRow = ({
  user,
  callerRole,
  organizations,
  showOrganizationColumn = true,
  showSelectionColumn = false,
  isSelected = false,
  canSelect = false,
  onToggleSelect,
  bulkMode = false,
  onAssignOrganization,
  onChangeRole,
  onDisable,
  onEnable,
  onPasswordSetupLink,
}: UserRowProps) => {
  const ui = useUi();
  const [selectedRole, setSelectedRole] = useState<Role>(user.role);
  const [isSaving, setIsSaving] = useState(false);
  const [isDisabling, setIsDisabling] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState<string>(user.organization_id ?? "");
  const [isAssigningOrg, setIsAssigningOrg] = useState(false);

  useEffect(() => {
    setSelectedRole(user.role);
  }, [user.role]);

  useEffect(() => {
    setSelectedOrgId(user.organization_id ?? "");
  }, [user.organization_id]);

  const isTargetSuperAdmin = user.role === "super_admin";
  const isEnabled = user.is_active !== false; // treat null/undefined as enabled
  const isPending = isEnabled && user.onboarding_status === "pending";

  const orgDisplay = (() => {
    const orgId = user.organization_id ?? null;
    if (!orgId) return null;
    const org = (organizations ?? []).find((o) => o.id === orgId);
    const name = (org as { name?: unknown } | null)?.name;
    const slug = (org as { slug?: unknown } | null)?.slug;
    const isInactive = (org as { is_active?: unknown } | null)?.is_active === false;
    const suffix = isInactive ? " (inactive)" : "";
    if (typeof name === "string" && name.trim().length > 0) return `${name.trim()}${suffix}`;
    if (typeof slug === "string" && slug.trim().length > 0) return `${slug.trim()}${suffix}`;
    return orgId;
  })();

  // For the super_admin row: no role change, no resend, no disable/enable.
  const canSendSetupLink = (() => {
    if (!callerRole) return false;
    if (callerRole === "member") return false;
    if (callerRole === "super_admin") return true; // can send to anyone, including super_admin
    if (callerRole === "system_admin") return user.role !== "super_admin";
    if (callerRole === "organization_admin") return user.role === "member" || user.role === "organization_admin";
    return false;
  })();
  const canEditRole = !!callerRole && (callerRole === "super_admin" || callerRole === "system_admin") && !isTargetSuperAdmin;
  const canAssignOrg =
    !!callerRole &&
    (callerRole === "super_admin" || callerRole === "system_admin") &&
    (user.role === "organization_admin" || user.role === "member") &&
    !isTargetSuperAdmin &&
    typeof onAssignOrganization === "function";

  const selectedOrg = (organizations ?? []).find((o) => o.id === selectedOrgId);
  const selectedOrgIsInactive = !!selectedOrg && selectedOrg.is_active === false;

  const roleOptions: Role[] = (() => {
    // UI-level guard (server will enforce regardless)
    if (callerRole === 'system_admin') {
      return ['system_admin', 'organization_admin', 'member'];
    }
    // super_admin caller: super_admin role is not assignable via UI
    return ['system_admin', 'organization_admin', 'member'];
  })();

  return (
    <tr className="border-b hover:bg-gray-50">
      {showSelectionColumn ? (
        <td className="px-4 py-3">
          {canSelect ? (
            <input
              type="checkbox"
              checked={isSelected}
              className="h-4 w-4 rounded border-gray-300 hover:cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                // Make the checked checkbox use --brand-primary at ~95% opacity (via color-mix)
                // This maps to the checkbox's accent color in modern browsers.
                accentColor: "color-mix(in srgb, var(--brand-primary) 95%, transparent)",
              }}
              onChange={(e) => {
                if (!canSelect) return;
                onToggleSelect?.(user.id, e.target.checked);
              }}
            />
          ) : (
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded border border-red-600 bg-red-50 text-xs font-bold text-red-700"
              title={ui("Not selectable")}
            >
              X
            </span>
          )}
        </td>
      ) : null}
      <td className="px-4 py-3">
        {user.full_name && String(user.full_name).trim().length > 0 ? (
          <span className="font-medium">{String(user.full_name).trim()}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3">{user.email}</td>
      <td className="px-4 py-3">
        {isTargetSuperAdmin ? (
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-900 text-white">
            {ui("super_admin")}</span>
        ) : !canEditRole ? (
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800">
            {ui(roleLabel(user.role))}
          </span>
        ) : (
          <div className="flex items-center gap-2">
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as Role)}
              className="px-2 py-1 text-xs border rounded-md bg-white hover:cursor-pointer disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed"
              disabled={!canEditRole || bulkMode}
            >
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {ui(roleLabel(r))}
                </option>
              ))}
            </select>
            {selectedRole !== user.role && (
              <Button
                size="sm"
                variant="outline"
                disabled={isSaving || bulkMode}
                onClick={async () => {
                  setIsSaving(true);
                  const t = toast.loading(ui("Saving role…"));
                  try {
                    const res = await onChangeRole(user.id, selectedRole);
                    toast.success(ui(res.message || "Role updated."), { id: t });
                  } catch (e) {
                    toast.error(ui(e instanceof Error ? e.message : "Failed to update role"), { id: t });
                  } finally {
                    setIsSaving(false);
                  }
                }}
              >
                {isSaving ? ui("Saving…") : ui("Save")}
              </Button>
            )}
          </div>
        )}
      </td>
      {showOrganizationColumn ? (
        <td className="px-4 py-3">
          {canAssignOrg ? (
            <div className="flex items-center gap-2">
              <select
                value={selectedOrgId}
                onChange={(e) => setSelectedOrgId(e.target.value)}
                className="px-2 py-1 text-xs border rounded-md bg-white hover:cursor-pointer disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                disabled={isAssigningOrg || bulkMode}
              >
                <option value="">{ui("Select an organization")}</option>
                {(organizations ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {(o.name?.trim()?.length ? o.name : o.slug?.trim()?.length ? o.slug : o.id) + (o.is_active === false ? ui(" (inactive)") : "")}
                  </option>
                ))}
              </select>
              {selectedOrgId && selectedOrgIsInactive ? (
                <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-700 px-2 py-0.5 text-xs font-medium whitespace-nowrap">
                  {ui("Inactive org")}</span>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={isAssigningOrg || bulkMode || !selectedOrgId || selectedOrgId === (user.organization_id ?? "")}
                onClick={async () => {
                  if (!selectedOrgId) return;
                  setIsAssigningOrg(true);
                  const t = toast.loading(ui("Assigning organization…"));
                  try {
                    const res = await onAssignOrganization(user.id, selectedOrgId);
                    toast.success(ui(res.message || "Organization assigned."), { id: t });
                  } catch (e) {
                    toast.error(ui(e instanceof Error ? e.message : "Failed to assign organization"), { id: t });
                  } finally {
                    setIsAssigningOrg(false);
                  }
                }}
              >
                {isAssigningOrg ? ui("Saving…") : ui("Save")}
              </Button>
            </div>
          ) : (
            <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800">
              {orgDisplay ? ui("Org: {v0}", {v0: orgDisplay}) : ui("No org")}
            </span>
          )}
        </td>
      ) : null}
      <td className="px-4 py-3">
        <span
          className={`px-2 py-1 text-xs font-medium rounded-full ${
            !isEnabled
              ? "bg-gray-200 text-gray-800"
              : isPending
                ? "bg-amber-100 text-amber-800"
                : "bg-green-100 text-green-700"
          }`}
        >
          {!isEnabled ? ui("Disabled") : isPending ? ui("Pending") : ui("Active")}
        </span>
      </td>
      <td className="px-4 py-3">
        {isTargetSuperAdmin ? (
          <span className="text-xs text-muted-foreground">{ui("Protected")}</span>
        ) : (
          <div className="flex gap-2">
            {canSendSetupLink ? (
              <Button
                size="sm"
                variant="outline"
                disabled={isResending || bulkMode}
                onClick={async () => {
                  setIsResending(true);
                  const t = toast.loading(ui("Sending setup link…"));
                  try {
                    const res = await onPasswordSetupLink(user.id);
                    toast.success(ui(res.message || "Setup link sent."), { id: t });
                  } catch (e) {
                    toast.error(ui(e instanceof Error ? e.message : "Failed to send setup link"), { id: t });
                  } finally {
                    setIsResending(false);
                  }
                }}
              >
                {isResending ? ui("Sending…") : ui("Setup link")}
              </Button>
            ) : null}

            {isEnabled ? (
              <Button
                size="sm"
                variant="destructive"
                className="bg-red-600 text-white hover:bg-red-700"
                disabled={isDisabling || bulkMode}
                onClick={async () => {
                  if (!confirm(ui("Disable this user? They will no longer be able to log in."))) return;
                  setIsDisabling(true);
                  const t = toast.loading(ui("Disabling user…"));
                  try {
                    const res = await onDisable(user.id);
                    toast.success(ui(res.message || "User disabled."), { id: t });
                  } catch (e) {
                    toast.error(ui(e instanceof Error ? e.message : "Failed to disable user"), { id: t });
                  } finally {
                    setIsDisabling(false);
                  }
                }}
              >
                {isDisabling ? ui("Disabling…") : ui("Disable")}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="border-green-600 text-green-700 hover:bg-green-50"
                disabled={isEnabling || bulkMode}
                onClick={async () => {
                  if (!confirm(ui("Enable this user? They will be able to log in again."))) return;
                  setIsEnabling(true);
                  const t = toast.loading(ui("Enabling user…"));
                  try {
                    const res = await onEnable(user.id);
                    toast.success(ui(res.message || "User enabled."), { id: t });
                  } catch (e) {
                    toast.error(ui(e instanceof Error ? e.message : "Failed to enable user"), { id: t });
                  } finally {
                    setIsEnabling(false);
                  }
                }}
              >
                {isEnabling ? ui("Enabling…") : ui("Enable")}
              </Button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
};

