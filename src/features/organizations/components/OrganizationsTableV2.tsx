"use client";
import {useUi} from "@/i18n/useUi";


import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Award,
  BookOpen,
  Building2,
  CalendarDays,
  CheckCheck,
  ChevronRight,
  Filter,
  Hash,
  Pencil,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react";

import type { Organization } from "../api/organizations.api";
import { useOrganizations } from "../hooks/useOrganizations";

import { Button } from "@/components/core/button";
import { Input } from "@/components/ui/input";
import { CreateOrganizationForm } from "./CreateOrganizationForm";
import { HelpText, UnderlineDropdown } from "@/components/table-v2/controls";
import { useBodyScrollLock, useEscClose, useMountedForAnimation, useOutsideClickClose } from "@/components/table-v2/hooks";
import { fetchJson } from "@/lib/api";

type StatusFilter = "all" | "active" | "inactive";
type SortKey = "created_at" | "name" | "status" | "users_count";
type SortDir = "asc" | "desc";
type FilterDropdownId = "status" | "sort";

function getStatus(org: Pick<Organization, "is_active">): StatusFilter {
  return org.is_active === false ? "inactive" : "active";
}

function formatIso(iso?: string | null, locale = "en"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(locale, { year: "numeric", month: "short", day: "2-digit" });
}

function StatusPill({ org, className }: { org: Organization; className?: string }) {
  const ui = useUi();
  const s = getStatus(org);
  const cls = s === "inactive" ? "bg-gray-200 text-gray-800" : "bg-green-100 text-green-700";
  const txt = s === "inactive" ? "Inactive" : "Active";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${cls} ${className ?? ""}`}>
      {ui(txt)}
    </span>
  );
}

function sortIcon(active: boolean, dir: SortDir | null) {
  if (!active || !dir) return <ArrowUpDown className="h-4 w-4 text-muted-foreground" />;
  return dir === "asc" ? (
    <ArrowUp className="h-4 w-4 text-muted-foreground" />
  ) : (
    <ArrowDown className="h-4 w-4 text-muted-foreground" />
  );
}

export function OrganizationsTableV2({
  title = "Organizations",
  subtitle = "Manage all organizations in the system",
}: {
  title?: string;
  subtitle?: string;
}) {
  const ui = useUi();
  const { organizations, countsErrors, isLoading, error, createOrganization, disableOrganization, enableOrganization, refetch } =
    useOrganizations();

  // UI state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [openFilterDropdown, setOpenFilterDropdown] = useState<FilterDropdownId | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [togglingOrgId, setTogglingOrgId] = useState<string | null>(null);

  // Drawer
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerMounted = useMountedForAnimation(drawerOpen, 220);

  // Mobile filter sheet
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const mobileFiltersMounted = useMountedForAnimation(mobileFiltersOpen, 220);

  useEscClose(drawerOpen, () => setDrawerOpen(false));
  useEscClose(mobileFiltersOpen, () => setMobileFiltersOpen(false));
  useBodyScrollLock(drawerOpen || mobileFiltersMounted);

  const isDropdownClickInside = useCallback(
    (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      const container = target.closest("[data-filter-dropdown]");
      const id = container?.getAttribute("data-filter-dropdown") as FilterDropdownId | null;
      return !!id && id === openFilterDropdown;
    },
    [openFilterDropdown]
  );

  useOutsideClickClose({
    enabled: openFilterDropdown !== null,
    onOutside: () => setOpenFilterDropdown(null),
    isInside: isDropdownClickInside,
  });

  const filteredOrganizations = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (organizations ?? []).filter((o) => {
      if (statusFilter !== "all" && getStatus(o) !== statusFilter) return false;
      if (!q) return true;
      const name = (o.name ?? "").toLowerCase();
      const slug = (o.slug ?? "").toLowerCase();
      const id = (o.id ?? "").toLowerCase();
      return name.includes(q) || slug.includes(q) || id.includes(q);
    });
  }, [organizations, search, statusFilter]);

  const sortedOrganizations = useMemo(() => {
    if (!sort?.key) return filteredOrganizations;
    const dirMult = sort.dir === "asc" ? 1 : -1;
    const list = [...filteredOrganizations];
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

    list.sort((a, b) => {
      if (sort.key === "name") {
        const av = (a.name ?? "").trim();
        const bv = (b.name ?? "").trim();
        if (!av && bv) return 1;
        if (av && !bv) return -1;
        return collator.compare(av, bv) * dirMult;
      }

      if (sort.key === "created_at") {
        const at = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
        return (at - bt) * dirMult;
      }

      if (sort.key === "status") {
        const av = getStatus(a);
        const bv = getStatus(b);
        // active > inactive by default (asc)
        const rank = (s: StatusFilter) => (s === "active" ? 2 : s === "inactive" ? 1 : 0);
        return (rank(av) - rank(bv)) * dirMult;
      }

      if (sort.key === "users_count") {
        const av = Number(a.users_count ?? 0);
        const bv = Number(b.users_count ?? 0);
        return (av - bv) * dirMult;
      }

      return 0;
    });

    return list;
  }, [filteredOrganizations, sort]);

  const activeOrg = useMemo(() => {
    if (!activeOrgId) return null;
    return (organizations ?? []).find((o) => o.id === activeOrgId) ?? null;
  }, [activeOrgId, organizations]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setSort(null);
    setOpenFilterDropdown(null);
  };

  const activeChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
    if (search.trim().length) chips.push({ key: "q", label: ui("Search: {v0}", {v0: search.trim()}), onRemove: () => setSearch("") });
    if (statusFilter !== "all") {
      chips.push({
        key: "status",
        label: ui("Status: {v0}", {v0: statusFilter === "active" ? "Active" : "Inactive"}),
        onRemove: () => setStatusFilter("all"),
      });
    }
    if (sort?.key) {
      const sortLabel =
        sort.key === "name"
          ? "Name"
          : sort.key === "created_at"
            ? "Created"
            : sort.key === "users_count"
              ? "Users"
              : "Status";
      const dir = sort.dir === "asc" ? "Asc" : "Desc";
      chips.push({ key: "sort", label: ui("Sort: {v0} ({v1})", {v0: ui(sortLabel), v1: ui(dir)}), onRemove: () => setSort(null) });
    }
    return chips;
  }, [search, sort?.dir, sort?.key, statusFilter, ui]);

  const handleCreate = async (input: { name: string; slug?: string }) => {
    const t = toast.loading(ui("Creating organization…"));
    try {
      const res = await createOrganization(input);
      toast.success(ui(res.message || "Organization created."), { id: t });
      setIsCreateOpen(false);
    } catch (e) {
      toast.error(ui(e instanceof Error ? e.message : "Failed to create organization"), { id: t });
    }
  };

  const handleDisable = async (orgId: string) => {
    if (!confirm(ui("Disable this organization? This will disable ALL users in it immediately."))) return;
    setTogglingOrgId(orgId);
    const t = toast.loading(ui("Disabling organization…"));
    try {
      const res = await disableOrganization(orgId);
      toast.success(ui(res.message || "Organization disabled."), { id: t });
    } catch (e) {
      toast.error(ui(e instanceof Error ? e.message : "Failed to disable organization"), { id: t });
    } finally {
      setTogglingOrgId(null);
    }
  };

  const handleEnable = async (orgId: string) => {
    if (!confirm(ui("Enable this organization? Users in it will be able to log in again."))) return;
    setTogglingOrgId(orgId);
    const t = toast.loading(ui("Enabling organization…"));
    try {
      const res = await enableOrganization(orgId);
      toast.success(ui(res.message || "Organization enabled."), { id: t });
    } catch (e) {
      toast.error(ui(e instanceof Error ? e.message : "Failed to enable organization"), { id: t });
    } finally {
      setTogglingOrgId(null);
    }
  };

  const handleRenameOrg = async (orgId: string, name: string) => {
    const t = toast.loading(ui("Updating organization name…"));
    try {
      const { message } = await fetchJson<{ organization: { id: string; name: string } }>(`/api/organizations/${orgId}/name`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      toast.success(ui(message || "Organization name updated."), { id: t });
      await refetch();
    } catch (e) {
      toast.error(ui(e instanceof Error ? e.message : "Failed to update organization name"), { id: t });
      throw e;
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-10">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Building2 className="h-8 w-8 text-primary shrink-0" />
            <div>
              <h2 className="text-2xl font-bold text-foreground">{ui(title)}</h2>
              <p className="text-muted-foreground">{ui(subtitle)}</p>
            </div>
          </div>
          <div className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Hash className="h-4 w-4" />
            <span>
              <span className="font-medium">{ui("Total:")}</span>{" "}
              {sortedOrganizations.length.toLocaleString(ui.locale)} {ui("organization")}{ui.locale === "sr-Latn" ? "" : (sortedOrganizations.length === 1 ? "" : "s")}
            </span>
          </div>
          <HelpText className="mt-2 border border-muted-foreground/50 rounded-md p-2"><b>{ui("Tip:")}</b> {ui("Click any row to open the details drawer.")}</HelpText>
        </div>
        <Button className="shrink-0 flex items-center gap-2" onClick={() => setIsCreateOpen((v) => !v)}>
          <Plus className="h-4 w-4" />
          {isCreateOpen ? ui("Close") : ui("Add Organization")}
        </Button>
      </div>

      {/* Create panel */}
      {isCreateOpen ? (
        <div className="rounded-lg border bg-background p-4 shadow-sm">
          <h3 className="text-lg font-semibold">{ui("Create organization")}</h3>
          <div className="mt-3">
            <CreateOrganizationForm onCreate={handleCreate} />
          </div>
        </div>
      ) : null}

      {/* Counts warnings (best-effort) */}
      {countsErrors?.courses ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {ui("Courses counts not available: ")}{countsErrors.courses}
        </div>
      ) : null}
      {countsErrors?.certificates ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {ui("Certificates counts not available: ")}{countsErrors.certificates}
        </div>
      ) : null}

      {/* Toolbar */}
      <div className="mb-6">
        <div className="flex flex-col gap-3">
          {/* Mobile: search + Filters button */}
          <div className="flex items-center gap-2 lg:hidden">
            <div className="flex-1 border-b border-primary">
              <div className="relative">
                <Search className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={ui("Search organizations…")}
                  className="pl-6 border-0 rounded-none shadow-none focus-visible:ring-0 focus-visible:border-0"
                />
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => setMobileFiltersOpen(true)}
              className="hover:bg-primary hover:text-white hover:border-primary"
            >
              <Filter className="h-4 w-4" />
              {ui("Filters")}</Button>
          </div>

          {/* Desktop/tablet: all controls visible + wrap */}
          <div className="hidden lg:flex flex-wrap items-end gap-6">
            <div className="min-w-[260px] flex-1 lg:flex-none lg:w-[420px]">
              <div className="text-xs text-muted-foreground mb-1">{ui("Search")}</div>
              <div className="border-b border-primary">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={ui("Search organizations…")}
                    className="pl-6 border-0 rounded-none shadow-none focus-visible:ring-0 focus-visible:border-0"
                  />
                </div>
              </div>
            </div>

            <UnderlineDropdown
              id="status"
              label={ui("Status")}
              value={statusFilter}
              options={[
                { value: "all", label: ui("All status") },
                { value: "active", label: ui("Active") },
                { value: "inactive", label: ui("Inactive") },
              ]}
              open={openFilterDropdown === "status"}
              onToggle={() => setOpenFilterDropdown((v) => (v === "status" ? null : "status"))}
              onSelect={(v) => {
                setStatusFilter(v as StatusFilter);
                setOpenFilterDropdown(null);
              }}
            />

            <UnderlineDropdown
              id="sort"
              label={ui("Sort")}
              value={(sort?.key ? `${sort.key}:${sort.dir}` : "none") as string}
              options={[
                { value: "none", label: ui("Default (Created desc)") },
                { value: "name:asc", label: ui("Name (A → Z)") },
                { value: "name:desc", label: ui("Name (Z → A)") },
                { value: "created_at:desc", label: ui("Created (new → old)") },
                { value: "created_at:asc", label: ui("Created (old → new)") },
                { value: "status:desc", label: ui("Status (Active first)") },
                { value: "status:asc", label: ui("Status (Inactive first)") },
                { value: "users_count:desc", label: ui("Users (high → low)") },
                { value: "users_count:asc", label: ui("Users (low → high)") },
              ]}
              open={openFilterDropdown === "sort"}
              onToggle={() => setOpenFilterDropdown((v) => (v === "sort" ? null : "sort"))}
              onSelect={(v) => {
                setOpenFilterDropdown(null);
                if (v === "none") {
                  setSort(null);
                  return;
                }
                const [key, dir] = String(v).split(":") as [SortKey, SortDir];
                setSort({ key, dir });
              }}
            />

            <div className="flex items-center gap-2 pb-2">
              <Button
                variant="outline"
                onClick={clearFilters}
                disabled={activeChips.length === 0}
                className="hover:bg-primary hover:text-white hover:border-primary"
              >
                {ui("Clear")}</Button>
            </div>
          </div>
        </div>

        {/* Active chips */}
        {activeChips.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {activeChips.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={c.onRemove}
                className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs text-foreground hover:bg-muted/40"
              >
                <span className="truncate max-w-[280px]">{ui(c.label)}</span>
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {ui("Failed to load organizations: ")}{ui(error.message)}
        </div>
      ) : null}

      {/* Desktop table (minimal columns; details in drawer) */}
      <div className="hidden lg:block rounded-md border bg-background overflow-hidden shadow-sm">
        <div className="w-full overflow-x-auto">
          <table className="min-w-max w-full">
            <thead className="bg-background border-b">
              <tr>
                <th className="px-4 py-5 text-left text-md font-medium text-muted-foreground">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
                    onClick={() => toggleSort("name")}
                  >
                    {ui("Organization")}{sortIcon(sort?.key === "name", sort?.key === "name" ? sort.dir : null)}
                  </button>
                </th>
                <th className="px-4 py-5 text-left text-md font-medium text-muted-foreground">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
                    onClick={() => toggleSort("users_count")}
                  >
                    {ui("Users (A / D / T)")}{sortIcon(sort?.key === "users_count", sort?.key === "users_count" ? sort.dir : null)}
                  </button>
                </th>
                <th className="px-4 py-5 text-left text-md font-medium text-muted-foreground">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
                    onClick={() => toggleSort("status")}
                  >
                    {ui("Status")}{sortIcon(sort?.key === "status", sort?.key === "status" ? sort.dir : null)}
                  </button>
                </th>
                <th className="px-4 py-5 text-right text-xs font-medium text-muted-foreground">{ui("Details")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    {ui("Loading organizations…")}</td>
                </tr>
              ) : sortedOrganizations.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    {ui("No organizations found.")}</td>
                </tr>
              ) : (
                sortedOrganizations.map((org) => {
                  const rowSelected = activeOrgId === org.id && drawerOpen;
                  const rowText = rowSelected ? "text-white" : "text-foreground group-hover:text-white";
                  const rowMuted = rowSelected ? "text-white/80" : "text-muted-foreground group-hover:text-white/80";
                  const name = org.name && String(org.name).trim().length ? String(org.name).trim() : "(no name)";
                  const slug = org.slug && String(org.slug).trim().length ? String(org.slug).trim() : org.id;

                  return (
                    <tr
                      key={org.id}
                      className={`group transition-colors cursor-pointer hover:bg-primary/90 hover:text-white ${
                        rowSelected ? "bg-primary/90 text-white" : ""
                      }`}
                      onClick={() => {
                        setActiveOrgId(org.id);
                        setDrawerOpen(true);
                      }}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`h-10 w-10 shrink-0 rounded-lg flex items-center justify-center ${
                              rowSelected ? "bg-white/15" : "bg-primary/10 group-hover:bg-white/15"
                            }`}
                          >
                            <Building2 className={`h-5 w-5 ${rowSelected ? "text-white" : "text-primary group-hover:text-white"}`} />
                          </div>
                          <div className="min-w-0">
                            <div className={`font-medium truncate ${rowText}`}>{name}</div>
                            <div className={`text-xs font-mono truncate ${rowMuted}`}>{slug}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className={`inline-flex items-center gap-2 ${rowMuted}`}>
                          <Users className="h-4 w-4" />
                          {(org.users_active_count ?? 0)} / {(org.users_disabled_count ?? 0)} / {(org.users_count ?? 0)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill
                          org={org}
                          className={rowSelected ? "bg-white/15 text-white" : "group-hover:bg-white/15 group-hover:text-white"}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="sr-only">{ui("Open details")}</span>
                        <ChevronRight className={`inline-block h-4 w-4 ${rowMuted}`} aria-hidden="true" />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="lg:hidden space-y-3">
        {isLoading ? (
          <div className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">
            {ui("Loading organizations…")}</div>
        ) : sortedOrganizations.length === 0 ? (
          <div className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">{ui("No organizations found.")}</div>
        ) : (
          sortedOrganizations.map((org) => (
            <MobileOrganizationCard
              key={org.id}
              org={org}
              busy={togglingOrgId === org.id}
              onOpenDetails={() => {
                setActiveOrgId(org.id);
                setDrawerOpen(true);
              }}
            />
          ))
        )}
      </div>

      {/* Desktop drawer */}
      {drawerMounted && activeOrg ? (
        <OrganizationDetailsDrawer
          open={drawerOpen}
          org={activeOrg}
          busy={togglingOrgId === activeOrg.id}
          onClose={() => setDrawerOpen(false)}
          onEnable={() => void handleEnable(activeOrg.id)}
          onDisable={() => void handleDisable(activeOrg.id)}
          onRename={(nextName) => handleRenameOrg(activeOrg.id, nextName)}
        />
      ) : null}

      {/* Mobile filter sheet */}
      {mobileFiltersMounted ? (
        <MobileFilterSheet
          open={mobileFiltersOpen}
          statusFilter={statusFilter}
          sortValue={(sort?.key ? `${sort.key}:${sort.dir}` : "none") as string}
          onChangeStatusFilter={setStatusFilter}
          onChangeSortValue={(v) => {
            if (v === "none") {
              setSort(null);
              return;
            }
            const [key, dir] = String(v).split(":") as [SortKey, SortDir];
            setSort({ key, dir });
          }}
          onClear={clearFilters}
          onClose={() => setMobileFiltersOpen(false)}
        />
      ) : null}
    </div>
  );
}

function OrganizationDetailsDrawer(props: {
  open: boolean;
  org: Organization;
  busy: boolean;
  onClose: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onRename: (nextName: string) => Promise<void>;
}) {
  const ui = useUi();
  const [entered, setEntered] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);

  // Mount hidden for 1 tick so "open" animates like "close".
  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), 0);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const n = props.org.name && String(props.org.name).trim().length ? String(props.org.name).trim() : "";
    setNameInput(n);
  }, [props.org.id, props.org.name]);

  const show = props.open && entered;
  const status = getStatus(props.org);
  const statusTone = status === "inactive" ? "text-gray-700" : "text-emerald-700";

  const name = props.org.name && String(props.org.name).trim().length ? String(props.org.name).trim() : "(no name)";
  const slug = props.org.slug && String(props.org.slug).trim().length ? String(props.org.slug).trim() : props.org.id;

  return (
    <div className="fixed inset-0 z-100000" role="dialog" aria-modal="true" onClick={props.onClose}>
      <div
        className={`absolute inset-0 z-0 bg-black/40 transition-opacity duration-200 ${show ? "opacity-100" : "opacity-0"}`}
        aria-hidden="true"
      />

      <div
        className={`
          fixed right-0 top-0 bottom-0 z-10 w-full max-w-[750px] bg-background shadow-2xl border-l flex flex-col
          transition-transform duration-200 ease-out
          ${show ? "translate-x-0" : "translate-x-full"}
          lg:right-6 lg:top-[30px] lg:bottom-6 lg:border lg:rounded-3xl
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="h-16 px-6 flex items-center justify-between">
          <div className="text-md font-semibold text-foreground bg-muted-foreground/10 rounded-md px-6 py-2">
            {ui("Organization Details")}</div>
          <button
            type="button"
            aria-label={ui("Close")}
            className="inline-flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={props.onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b" />

        {/* Content */}
        <div className="flex-1 overflow-auto px-6 py-6 space-y-6">
          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl bg-muted/30 border p-5">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-lg bg-background border flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    {isEditingName ? (
                      <Input
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        disabled={props.busy || isSavingName}
                        className="h-9"
                        placeholder={ui("Organization name")}
                      />
                    ) : (
                      <div className="text-lg font-semibold text-primary truncate">{name}</div>
                    )}

                    {isEditingName ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={props.busy || isSavingName || nameInput.trim().replace(/\s+/g, " ").length < 2}
                          className="shrink-0"
                          onClick={async () => {
                            if (isSavingName) return;
                            setIsSavingName(true);
                            try {
                              await props.onRename(nameInput.trim().replace(/\s+/g, " "));
                              setIsEditingName(false);
                            } finally {
                              setIsSavingName(false);
                            }
                          }}
                        >
                          {isSavingName ? ui("Saving…") : ui("Save")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={props.busy || isSavingName}
                          className="shrink-0"
                          onClick={() => {
                            setIsEditingName(false);
                            const n = props.org.name && String(props.org.name).trim().length ? String(props.org.name).trim() : "";
                            setNameInput(n);
                          }}
                        >
                          {ui("Cancel")}</Button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background hover:bg-muted/40"
                        aria-label={ui("Rename organization")}
                        onClick={() => setIsEditingName(true)}
                      >
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </button>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono truncate">{slug}</div>
                </div>
              </div>
              <div className="mt-4 inline-flex items-center gap-2">
                <CheckCheck className={`h-4 w-4 ${statusTone}`} />
                <span className={`text-sm font-medium ${statusTone}`}>{status === "inactive" ? ui("Inactive") : ui("Active")}</span>
              </div>
              <HelpText>{ui("Click actions below to enable/disable this organization.")}</HelpText>
            </div>

            <div className="rounded-xl border bg-background p-5">
              <div className="space-y-3 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <CalendarDays className="h-4 w-4" />
                    {ui("Created")}</span>
                  <span className="text-foreground text-right">{formatIso(props.org.created_at, ui.locale)}</span>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Users className="h-4 w-4" />
                    {ui("Users (A / D / T)")}</span>
                  <span className="text-foreground text-right">
                    {(props.org.users_active_count ?? 0)} / {(props.org.users_disabled_count ?? 0)} / {(props.org.users_count ?? 0)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t" />

          {/* Metrics */}
          <div className="space-y-3">
            <div className="text-xl font-semibold text-foreground">{ui("Metrics")}</div>
            <div className="rounded-xl border bg-background p-5">
              <div className="grid grid-cols-1 gap-3 text-sm">
                <div className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <BookOpen className="h-4 w-4" />
                    {ui("Courses")}</span>
                  <span className="text-foreground font-medium">{props.org.courses_count ?? 0}</span>
                </div>
                <div className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Award className="h-4 w-4" />
                    {ui("Certificates")}</span>
                  <span className="text-foreground font-medium">{props.org.certificates_count ?? 0}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t" />

          {/* Actions */}
          <div className="space-y-3">
            <div className="text-xl font-semibold text-foreground">{ui("Actions")}</div>
            <div className="rounded-xl border bg-background p-5">
              <div className="flex flex-wrap gap-4">
                {getStatus(props.org) === "inactive" ? (
                  <div className="flex flex-col items-start gap-1 max-w-[320px]">
                    <Button
                      variant="outline"
                      disabled={props.busy}
                      className="border-green-600 text-green-700 hover:bg-green-50"
                      onClick={props.onEnable}
                    >
                      {props.busy ? ui("Enabling…") : ui("Enable")}
                    </Button>
                    <HelpText>{ui("Re-enables this organization and restores access for users disabled due to org disable.")}</HelpText>
                  </div>
                ) : (
                  <div className="flex flex-col items-start gap-1 max-w-[320px]">
                    <Button variant="destructive" disabled={props.busy} onClick={props.onDisable}>
                      {props.busy ? ui("Disabling…") : ui("Disable")}
                    </Button>
                    <HelpText>{ui("Disables this organization and immediately disables all users in it.")}</HelpText>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileFilterSheet(props: {
  open: boolean;
  statusFilter: StatusFilter;
  sortValue: string;
  onChangeStatusFilter: (v: StatusFilter) => void;
  onChangeSortValue: (v: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const ui = useUi();
  const [openDropdown, setOpenDropdown] = useState<FilterDropdownId | null>(null);
  const [entered, setEntered] = useState(false);

  useOutsideClickClose({
    enabled: openDropdown !== null,
    onOutside: () => setOpenDropdown(null),
    isInside: (target) => {
      if (!(target instanceof Element)) return false;
      const container = target.closest("[data-filter-dropdown]");
      const id = container?.getAttribute("data-filter-dropdown") as FilterDropdownId | null;
      return !!id && id === openDropdown;
    },
  });

  // Mount hidden for 1 tick so "open" animates like "close".
  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), 0);
    return () => window.clearTimeout(t);
  }, []);

  const show = props.open && entered;

  return (
    <div className="fixed inset-0 z-100000 flex" role="dialog" aria-modal="true" onClick={props.onClose}>
      <div className={`absolute inset-0 bg-black/40 z-0 transition-opacity duration-200 ${show ? "opacity-100" : "opacity-0"}`} />
      <div
        className={`
          relative z-10 h-full w-[320px] max-w-[90vw] bg-background shadow-2xl border-r flex flex-col
          transition-transform duration-200 ease-out
          ${show ? "translate-x-0" : "-translate-x-full"}
        `}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div className="text-lg font-semibold">{ui("Filters")}</div>
          <button
            type="button"
            aria-label={ui("Close")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-primary hover:text-white hover:border-primary"
            onClick={props.onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          <UnderlineDropdown
            id="status"
            label={ui("Status")}
            value={props.statusFilter}
            options={[
              { value: "all", label: ui("All status") },
              { value: "active", label: ui("Active") },
              { value: "inactive", label: ui("Inactive") },
            ]}
            open={openDropdown === "status"}
            onToggle={() => setOpenDropdown((v) => (v === "status" ? null : "status"))}
            onSelect={(v) => {
              props.onChangeStatusFilter(v as StatusFilter);
              setOpenDropdown(null);
            }}
          />

          <UnderlineDropdown
            id="sort"
            label={ui("Sort")}
            value={props.sortValue as string}
            options={[
              { value: "none", label: ui("Default (Created desc)") },
              { value: "name:asc", label: ui("Name (A → Z)") },
              { value: "name:desc", label: ui("Name (Z → A)") },
              { value: "created_at:desc", label: ui("Created (new → old)") },
              { value: "created_at:asc", label: ui("Created (old → new)") },
              { value: "status:desc", label: ui("Status (Active first)") },
              { value: "status:asc", label: ui("Status (Inactive first)") },
              { value: "users_count:desc", label: ui("Users (high → low)") },
              { value: "users_count:asc", label: ui("Users (low → high)") },
            ]}
            open={openDropdown === "sort"}
            onToggle={() => setOpenDropdown((v) => (v === "sort" ? null : "sort"))}
            onSelect={(v) => {
              props.onChangeSortValue(String(v));
              setOpenDropdown(null);
            }}
          />
        </div>

        <div className="p-5 border-t flex items-center justify-between">
          <Button variant="outline" onClick={props.onClear} className="hover:bg-primary hover:text-white hover:border-primary">
            {ui("Clear")}</Button>
          <Button onClick={props.onClose}>{ui("Apply")}</Button>
        </div>
      </div>
    </div>
  );
}

function MobileOrganizationCard(props: {
  org: Organization;
  busy: boolean;
  onOpenDetails: () => void;
}) {
  const ui = useUi();
  const org = props.org;
  const name = org.name && String(org.name).trim().length ? String(org.name).trim() : "(no name)";
  const slug = org.slug && String(org.slug).trim().length ? String(org.slug).trim() : org.id;

  return (
    <div className="rounded-lg border bg-background p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold truncate">{name}</div>
            <div className="text-xs text-muted-foreground font-mono truncate">{slug}</div>
          </div>
        </div>
        <StatusPill org={org} />
      </div>

      <div className="mt-4 rounded-md border bg-muted/20 p-3 text-sm">
        <div className="text-xs text-muted-foreground">{ui("Users (A / D / T)")}</div>
        <div className="mt-1 font-medium">
          {(org.users_active_count ?? 0)} / {(org.users_disabled_count ?? 0)} / {(org.users_count ?? 0)}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={props.onOpenDetails} className="ml-auto hover:bg-primary hover:text-white hover:border-primary">
          {ui("Details")}</Button>
      </div>
    </div>
  );
}

