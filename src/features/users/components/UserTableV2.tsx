'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  CalendarDays,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Filter,
  Mail,
  Search,
  Send,
  Users,
  X,
} from "lucide-react";

import type { Role } from "@/types";
import type { ApiUser, AssignableCourse } from "../api/users.api";
import type { Organization } from "@/features/organizations";

import { useUsers } from "../hooks/useUsers";
import { useOrganizations } from "@/features/organizations";
import { roleLabel } from "@/lib/utils/roleLabel";
import { ACCESS_DURATION_KEYS, accessKeyLabel, type AccessDurationKey, isAccessDurationKey } from "@/lib/courseAssignments/access";

import { Button } from "@/components/core/button";
import { Input } from "@/components/ui/input";
import { UserForm } from "./UserForm";
import type { UserFormData } from "../validations/user.schema";
import { UserTableBulkFilterModal } from "@/components/core";

type StatusFilter = "all" | "active" | "pending" | "disabled";
type OrgFilter = "all" | "none" | string;

type SortKey = "name" | "role" | "organization" | "status";
type SortDir = "asc" | "desc";

type FilterDropdownId = "role" | "status" | "organization";

function getStatus(u: Pick<ApiUser, "is_active" | "onboarding_status">): StatusFilter {
  const enabled = u.is_active !== false;
  if (!enabled) return "disabled";
  if (u.onboarding_status === "pending") return "pending";
  return "active";
}

function getInitials(user: ApiUser): string {
  const name = (user.full_name ?? "").trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] ?? "";
    const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
    const out = (a + b).toUpperCase();
    return out || (user.email?.[0] ?? "?").toUpperCase();
  }
  return (user.email?.[0] ?? "?").toUpperCase();
}

function formatIso(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function HelpText({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`mt-1 text-xs text-muted-foreground ${className ?? ""}`}>{children}</div>;
}

function StatusPill({ user, className }: { user: ApiUser; className?: string }) {
  const s = getStatus(user);
  const cls =
    s === "disabled"
      ? "bg-gray-200 text-gray-800"
      : s === "pending"
        ? "bg-amber-100 text-amber-800"
        : "bg-green-100 text-green-700";
  const txt = s === "disabled" ? "Disabled" : s === "pending" ? "Pending" : "Active";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${cls} ${className ?? ""}`}>
      {txt}
    </span>
  );
}

function OrgChip({ label, inactive, className }: { label: string; inactive: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 px-2 py-1 text-xs ${className ?? "text-foreground"}`}>
      <span className="truncate max-w-[220px]">{label}</span>
      {inactive ? <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">Inactive</span> : null}
    </span>
  );
}

function FilterSelect<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={`relative ${props.className ?? ""}`}>
      <select
        aria-label={props.ariaLabel}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value as T)}
        disabled={props.disabled}
        className={`
          h-9 w-full appearance-none rounded-md border bg-background pl-3 pr-8 text-sm
          shadow-xs transition-colors
          hover:bg-muted/20 hover:cursor-pointer
          disabled:opacity-60 disabled:cursor-not-allowed
        `}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

function UnderlineDropdown<T extends string>({
  id,
  label,
  value,
  options,
  open,
  onToggle,
  onSelect,
  disabled,
}: {
  id: FilterDropdownId;
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  open: boolean;
  onToggle: () => void;
  onSelect: (v: T) => void;
  disabled?: boolean;
}) {
  const selectedLabel = options.find((o) => o.value === value)?.label ?? "";

  return (
    <div className="min-w-[180px]">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div data-filter-dropdown={id} className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            onToggle();
          }}
          className={`
            w-full flex items-center justify-between gap-3
            border-b border-primary
            pb-2 text-sm
            ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}
          `}
        >
          <span className="min-w-0 truncate text-foreground">{selectedLabel}</span>
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-primary-foreground">
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </span>
        </button>

        {open ? (
          <div className="absolute left-0 mt-2 w-full rounded-sm border bg-background shadow-lg overflow-hidden z-50">
            {options.map((o) => {
              const active = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => onSelect(o.value)}
                  className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                    active ? "bg-primary text-white" : "text-foreground cursor-pointer"
                  } hover:bg-primary/90 hover:text-white`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function canSendSetupLink(callerRole: Role | null, targetRole: Role): boolean {
  if (!callerRole) return false;
  if (callerRole === "member") return false;
  if (callerRole === "super_admin") return true;
  if (callerRole === "system_admin") return targetRole === "system_admin" || targetRole === "organization_admin";
  if (callerRole === "organization_admin") return targetRole === "member" || targetRole === "organization_admin";
  return false;
}

function canEditRole(callerRole: Role | null, targetRole: Role): boolean {
  if (!callerRole) return false;
  if (targetRole === "super_admin") return false;
  if (callerRole === "system_admin") return targetRole === "system_admin" || targetRole === "organization_admin";
  return (
    callerRole === "super_admin" ||
    (callerRole === "organization_admin" && (targetRole === "member" || targetRole === "organization_admin"))
  );
}

function canAssignOrg(callerRole: Role | null, targetRole: Role): boolean {
  if (!callerRole) return false;
  if (targetRole === "super_admin") return false;
  if (!(targetRole === "organization_admin" || targetRole === "member")) return false;
  if (callerRole === "system_admin") return targetRole === "organization_admin";
  return callerRole === "super_admin";
}

function canDeleteUser(callerRole: Role | null, targetRole: Role): boolean {
  if (!callerRole) return false;
  if (callerRole === "member") return false;
  if (targetRole === "super_admin") return false;
  // Safety: org admins can delete members only (server enforces org match).
  if (callerRole === "organization_admin") return targetRole === "member";
  if (callerRole === "system_admin") return targetRole === "system_admin" || targetRole === "organization_admin";
  return callerRole === "super_admin";
}

function allowedRoleOptions(callerRole: Role | null): Role[] {
  // UI-level guard; server enforces regardless.
  if (!callerRole) return ["member"];
  if (callerRole === "system_admin") return ["system_admin", "organization_admin"];
  if (callerRole === "super_admin") return ["system_admin", "organization_admin", "member"];
  if (callerRole === "organization_admin") return ["organization_admin", "member"];
  return ["member"];
}

function resolveOrgLabel(org: Organization): { label: string; inactive: boolean } {
  const inactive = org.is_active === false;
  const name = typeof org.name === "string" && org.name.trim().length ? org.name.trim() : null;
  const slug = typeof org.slug === "string" && org.slug.trim().length ? org.slug.trim() : null;
  const label = name ?? slug ?? org.id;
  return { label, inactive };
}

function areStringSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}

type CourseAssignmentInfo = {
  course_id: string;
  access: AccessDurationKey;
  access_expires_at: string | null;
  access_duration_key: string | null;
  assigned_at: string | null;
};

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function deriveAccessKeyFromAssignment(row: {
  access_duration_key: string | null;
  access_expires_at: string | null;
  assigned_at: string | null;
}): AccessDurationKey {
  if (isAccessDurationKey(row.access_duration_key)) return row.access_duration_key;
  if (!row.access_expires_at) return "unlimited";

  // Best-effort inference for legacy rows where only expires_at exists.
  const assignedMs = row.assigned_at ? new Date(row.assigned_at).getTime() : Number.NaN;
  const expiresMs = new Date(row.access_expires_at).getTime();
  if (Number.isFinite(assignedMs) && Number.isFinite(expiresMs) && expiresMs > assignedMs) {
    const diffDays = (expiresMs - assignedMs) / (1000 * 60 * 60 * 24);
    if (diffDays <= 8) return "1w";
    if (diffDays <= 40) return "1m";
    if (diffDays <= 110) return "3m";
  }

  return "1m";
}

function areCourseAccessMapsEqualForSet(
  ids: Set<string>,
  a: Record<string, AccessDurationKey>,
  b: Record<string, AccessDurationKey>
): boolean {
  for (const id of ids) {
    const av = a[id] ?? "unlimited";
    const bv = b[id] ?? "unlimited";
    if (av !== bv) return false;
  }
  return true;
}

export function UserTableV2({
  title = "All Users",
  organizationId,
  organizationLabel,
}: {
  title?: string;
  organizationId?: string;
  organizationLabel?: string;
}) {
  const orgScoped = typeof organizationId === "string" && organizationId.trim().length > 0;
  const orgScopedId = orgScoped ? organizationId.trim() : null;
  const orgScopedLabel =
    typeof organizationLabel === "string" && organizationLabel.trim().length > 0 ? organizationLabel.trim() : orgScopedId;

  const {
    users,
    callerRole,
    isLoading,
    error,
    inviteUser,
    changeUserRole,
    disableUser,
    enableUser,
    deleteUser,
    resendInvite,
    assignOrganization,
    bulkAssignOrganization,
    sendPasswordSetupLink,
    getAssignableCourses,
    getUserCourseAssignments,
    replaceUserCourseAssignments,
    bulkCourseAssignments,
  } = useUsers(orgScopedId ?? undefined);

  const isOrgAdmin = callerRole === ("organization_admin" as Role);
  const canManageOrgs = callerRole === "super_admin" || callerRole === "system_admin";
  const { organizations } = useOrganizations({ enabled: canManageOrgs, includeCounts: false });
  const orgById = useMemo(() => {
    const m = new Map<string, Organization>();
    for (const o of organizations ?? []) {
      if (o?.id) m.set(o.id, o);
    }
    return m;
  }, [organizations]);

  const resolveOrgForUser = useCallback(
    (u: ApiUser): { label: string; inactive: boolean } | null => {
      const oid = typeof u.organization_id === "string" && u.organization_id.trim().length ? u.organization_id.trim() : null;
      // On org-scoped user pages, always present the current org context.
      // A member may belong to multiple orgs while `user.organization_id` still points to their home org.
      if (orgScopedId && orgScopedLabel) {
        return { label: orgScopedLabel, inactive: false };
      }
      if (oid) {
        const orgRow = orgById.get(oid) ?? null;
        if (orgRow) return resolveOrgLabel(orgRow);
      }
      return oid ? { label: oid, inactive: false } : null;
    },
    [orgById, orgScopedId, orgScopedLabel]
  );

  // Filters
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  const [orgFilter, setOrgFilter] = useState<OrgFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Desktop filter dropdown control (custom menus so we can style hover, radius, etc.)
  const [openFilterDropdown, setOpenFilterDropdown] = useState<FilterDropdownId | null>(null);

  // Sorting (resets on refresh by default)
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);

  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [mobileFiltersMounted, setMobileFiltersMounted] = useState(false);

  // Drawer
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMounted, setDrawerMounted] = useState(false);

  // Avatar fallbacks
  const [brokenAvatarIds, setBrokenAvatarIds] = useState<Set<string>>(new Set());

  // Invite form
  const [isInviteOpen, setIsInviteOpen] = useState(false);

  // Mobile/tablet: allow only one expanded card at a time
  const [openMobileUserId, setOpenMobileUserId] = useState<string | null>(null);

  // Bulk selection + bulk move state
  const showSelectionColumn =
    callerRole === "super_admin" || callerRole === "system_admin" || (isOrgAdmin && !!orgScopedId);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const bulkMode = showSelectionColumn && selectedUserIds.size > 0;
  const [bulkTargetOrgId, setBulkTargetOrgId] = useState<string>("");
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [isBulkApplying, setIsBulkApplying] = useState(false);
  const [bulkTargetRole, setBulkTargetRole] = useState<Role | "">("");
  const [bulkCourseId, setBulkCourseId] = useState<string>("");
  const [bulkCourseAccess, setBulkCourseAccess] = useState<AccessDurationKey>("unlimited");
  const [assignableCourses, setAssignableCourses] = useState<AssignableCourse[]>([]);
  const [isAssignableCoursesLoading, setIsAssignableCoursesLoading] = useState(false);

  useEffect(() => {
    if (!bulkMode) setBulkTargetRole("");
  }, [bulkMode]);

  useEffect(() => {
    if (!isOrgAdmin) {
      setAssignableCourses([]);
      setBulkCourseId("");
      setBulkCourseAccess("unlimited");
      return;
    }

    let cancelled = false;
    const loadAssignableCourses = async () => {
      setIsAssignableCoursesLoading(true);
      try {
        const data = await getAssignableCourses();
        if (cancelled) return;
        const list = Array.isArray(data.courses) ? data.courses : [];
        setAssignableCourses(list);
      } catch (e) {
        if (cancelled) return;
        toast.error(e instanceof Error ? e.message : "Failed to load assignable courses");
      } finally {
        if (!cancelled) setIsAssignableCoursesLoading(false);
      }
    };
    void loadAssignableCourses();
    return () => {
      cancelled = true;
    };
  }, [getAssignableCourses, isOrgAdmin]);

  const orgOptions = useMemo(() => {
    const opts = (organizations ?? []).map((o) => {
      const { label, inactive } = resolveOrgLabel(o);
      return { id: o.id, label: inactive ? `${label} (inactive)` : label };
    });
    opts.sort((a, b) => a.label.localeCompare(b.label));
    return opts;
  }, [organizations]);

  useEffect(() => {
    // Org-scoped view: organization filter is irrelevant; keep it cleared and avoid sorting by org.
    if (!orgScopedId) return;
    if (orgFilter !== "all") setOrgFilter("all");
    if (sort?.key === "organization") setSort(null);
  }, [orgFilter, orgScopedId, sort?.key]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;

      if (statusFilter !== "all") {
        const s = getStatus(u);
        if (s !== statusFilter) return false;
      }

      if (orgFilter !== "all") {
        const oid = u.organization_id ?? null;
        if (orgFilter === "none") return oid === null;
        return oid === orgFilter;
      }

      if (q.length) {
        const name = (u.full_name ?? "").toLowerCase();
        const email = (u.email ?? "").toLowerCase();
        const orgLabel = (resolveOrgForUser(u)?.label ?? "").toLowerCase();
        if (!name.includes(q) && !email.includes(q) && !orgLabel.includes(q)) return false;
      }

      return true;
    });
  }, [orgFilter, roleFilter, search, statusFilter, users, resolveOrgForUser]);

  const sortedUsers = useMemo(() => {
    if (!sort?.key) return filteredUsers;

    const dirMult = sort.dir === "asc" ? 1 : -1;

    const getName = (u: ApiUser) => (u.full_name ?? "").trim();
    const getOrgLabel = (u: ApiUser) => {
      return resolveOrgForUser(u)?.label ?? "";
    };
    const getRole = (u: ApiUser) => roleLabel(u.role);
    const getStatusLabel = (u: ApiUser) => {
      const s = getStatus(u);
      return s === "disabled" ? "Disabled" : s === "pending" ? "Pending" : "Active";
    };

    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

    const list = [...filteredUsers];
    list.sort((a, b) => {
      let av = "";
      let bv = "";

      if (sort.key === "name") {
        av = getName(a);
        bv = getName(b);
        // push blank names last
        if (!av && bv) return 1;
        if (av && !bv) return -1;
        return collator.compare(av, bv) * dirMult;
      }
      if (sort.key === "role") {
        av = getRole(a);
        bv = getRole(b);
        return collator.compare(av, bv) * dirMult;
      }
      if (sort.key === "organization") {
        av = getOrgLabel(a);
        bv = getOrgLabel(b);
        return collator.compare(av, bv) * dirMult;
      }
      if (sort.key === "status") {
        av = getStatusLabel(a);
        bv = getStatusLabel(b);
        return collator.compare(av, bv) * dirMult;
      }
      return 0;
    });

    return list;
  }, [filteredUsers, resolveOrgForUser, sort]);

  useEffect(() => {
    if (!openMobileUserId) return;
    const stillVisible = sortedUsers.some((u) => u.id === openMobileUserId);
    if (!stillVisible) setOpenMobileUserId(null);
  }, [openMobileUserId, sortedUsers]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null; // third click resets to default
    });
  };

  const sortIcon = (key: SortKey) => {
    if (!sort || sort.key !== key) return <ArrowUpDown className="h-4 w-4 text-muted-foreground" />;
    return sort.dir === "asc" ? (
      <ArrowUp className="h-4 w-4 text-muted-foreground" />
    ) : (
      <ArrowDown className="h-4 w-4 text-muted-foreground" />
    );
  };

  const selectableIds = useMemo(() => {
    if (!showSelectionColumn) return [];
    return filteredUsers
      .filter((u) => u.role === "member" || u.role === "organization_admin")
      .map((u) => u.id);
  }, [filteredUsers, showSelectionColumn]);

  const allSelectableSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedUserIds.has(id));
  const someSelectableSelected = selectableIds.some((id) => selectedUserIds.has(id)) && !allSelectableSelected;
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);
  const mobileSelectAllRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!headerCheckboxRef.current) return;
    headerCheckboxRef.current.indeterminate = someSelectableSelected;
  }, [someSelectableSelected]);

  useEffect(() => {
    if (!mobileSelectAllRef.current) return;
    mobileSelectAllRef.current.indeterminate = someSelectableSelected;
  }, [someSelectableSelected]);

  useEffect(() => {
    // Close desktop filter dropdowns on outside click / escape.
    if (!openFilterDropdown) return;

    const onMouseDown = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) {
        setOpenFilterDropdown(null);
        return;
      }
      const container = e.target.closest("[data-filter-dropdown]");
      const id = container?.getAttribute("data-filter-dropdown") as FilterDropdownId | null;
      if (id && id === openFilterDropdown) return;
      setOpenFilterDropdown(null);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenFilterDropdown(null);
    };

    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openFilterDropdown]);

  useEffect(() => {
    // Close drawer on escape
    if (!drawerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  useEffect(() => {
    // Close mobile filter sheet on escape
    if (!mobileFiltersOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileFiltersOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileFiltersOpen]);

  useEffect(() => {
    // Keep drawer mounted briefly for close animation.
    if (drawerOpen) {
      setDrawerMounted(true);
      return;
    }
    if (!drawerMounted) return;
    const t = window.setTimeout(() => setDrawerMounted(false), 220);
    return () => window.clearTimeout(t);
  }, [drawerMounted, drawerOpen]);

  useEffect(() => {
    // Keep mobile filter sheet mounted briefly for close animation.
    if (mobileFiltersOpen) {
      setMobileFiltersMounted(true);
      return;
    }
    if (!mobileFiltersMounted) return;
    const t = window.setTimeout(() => setMobileFiltersMounted(false), 220);
    return () => window.clearTimeout(t);
  }, [mobileFiltersMounted, mobileFiltersOpen]);

  useEffect(() => {
    // Lock body scroll while drawer or mobile filter sheet is open
    const open = drawerOpen || mobileFiltersMounted;
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen, mobileFiltersMounted]);

  const activeUser = useMemo(() => {
    if (!activeUserId) return null;
    return users.find((u) => u.id === activeUserId) ?? null;
  }, [activeUserId, users]);

  const clearFilters = () => {
    setSearch("");
    setRoleFilter("all");
    setOrgFilter("all");
    setStatusFilter("all");
    setOpenFilterDropdown(null);
  };

  const activeChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
    if (search.trim().length) {
      chips.push({ key: "q", label: `Search: ${search.trim()}`, onRemove: () => setSearch("") });
    }
    if (roleFilter !== "all") {
      chips.push({ key: "role", label: `Role: ${roleLabel(roleFilter)}`, onRemove: () => setRoleFilter("all") });
    }
    if (statusFilter !== "all") {
      const txt = statusFilter === "active" ? "Active" : statusFilter === "pending" ? "Pending" : "Disabled";
      chips.push({ key: "status", label: `Status: ${txt}`, onRemove: () => setStatusFilter("all") });
    }
    if (orgFilter !== "all") {
      chips.push({
        key: "org",
        label:
          orgFilter === "none"
            ? "Organization: None"
            : `Organization: ${(orgOptions.find((o) => o.id === orgFilter)?.label ?? String(orgFilter)).trim()}`,
        onRemove: () => setOrgFilter("all"),
      });
    }
    return chips;
  }, [orgFilter, orgOptions, roleFilter, search, statusFilter]);

  const bulkTargetOrg = (organizations ?? []).find((o) => o.id === bulkTargetOrgId) ?? null;
  const bulkTargetOrgIsInactive = !!bulkTargetOrg && bulkTargetOrg.is_active === false;
  const bulkTargetOrgLabel = bulkTargetOrg
    ? (() => {
        const { label, inactive } = resolveOrgLabel(bulkTargetOrg);
        return inactive ? `${label} (inactive)` : label;
      })()
    : bulkTargetOrgId || "—";

  const loadUserCourseAssignments = useCallback(
    async (userId: string) => {
      const res = await getUserCourseAssignments(userId);
      const raw =
        Array.isArray(res.assignments) && res.assignments.length
          ? res.assignments
          : (Array.isArray(res.course_ids) ? res.course_ids : []).map((course_id) => ({
              course_id,
              access_expires_at: null,
              access_duration_key: null,
              assigned_at: null,
            }));

      const assignments: CourseAssignmentInfo[] = raw
        .map((r) => {
          const course_id = typeof (r as { course_id?: unknown }).course_id === "string" ? String((r as { course_id: string }).course_id) : null;
          if (!course_id) return null;
          const access_expires_at =
            typeof (r as { access_expires_at?: unknown }).access_expires_at === "string"
              ? String((r as { access_expires_at: string }).access_expires_at)
              : null;
          const access_duration_key =
            typeof (r as { access_duration_key?: unknown }).access_duration_key === "string"
              ? String((r as { access_duration_key: string }).access_duration_key)
              : null;
          const assigned_at =
            typeof (r as { assigned_at?: unknown }).assigned_at === "string" ? String((r as { assigned_at: string }).assigned_at) : null;

          const access = deriveAccessKeyFromAssignment({ access_duration_key, access_expires_at, assigned_at });
          return { course_id, access, access_expires_at, access_duration_key, assigned_at };
        })
        .filter((v): v is CourseAssignmentInfo => !!v);

      return { assignments };
    },
    [getUserCourseAssignments]
  );

  const saveUserCourseAssignments = useCallback(
    async (userId: string, assignments: Array<{ course_id: string; access: AccessDurationKey }>) => {
      const res = await replaceUserCourseAssignments(userId, { assignments });
      return { message: res.message, assignments: Array.isArray(res.assignments) ? res.assignments : undefined };
    },
    [replaceUserCourseAssignments]
  );

  const handleInviteUser = async (data: UserFormData) => {
    const t = toast.loading("Inviting user…");
    try {
      const fullName = typeof data.full_name === "string" ? data.full_name.trim() : "";
      const effectiveOrgId =
        orgScopedId && (data.role === "member" || data.role === "organization_admin") ? orgScopedId : data.organization_id ?? null;
      const res = await inviteUser(
        data.email,
        data.role,
        effectiveOrgId,
        fullName.length ? fullName : null
      );
      toast.success(res.message || "User invited.", { id: t });
      setIsInviteOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to invite user", { id: t });
    }
  };

  const handleBulkCourseAction = async (action: "assign" | "remove") => {
    if (!bulkCourseId) return;
    if (selectedUserIds.size === 0) return;
    const ids = Array.from(selectedUserIds);
    const confirmMsg =
      action === "assign"
        ? `Assign selected course to ${ids.length} user${ids.length === 1 ? "" : "s"}?`
        : `Remove selected course from ${ids.length} user${ids.length === 1 ? "" : "s"}?`;
    if (!confirm(confirmMsg)) return;

    setIsBulkApplying(true);
    const t = toast.loading(action === "assign" ? "Assigning course…" : "Removing course assignment…");
    try {
      const res = await bulkCourseAssignments({
        user_ids: ids,
        course_id: bulkCourseId,
        action,
        ...(action === "assign" ? { access: bulkCourseAccess } : {}),
      });

      const successCount = res.success_count ?? 0;
      const failureCount = res.failure_count ?? 0;
      const failures = Array.isArray(res.failures) ? res.failures : [];

      if (failureCount === 0) {
        toast.success(res.message || `${action === "assign" ? "Assigned" : "Removed"} for ${successCount} user${successCount === 1 ? "" : "s"}.`, { id: t });
        setSelectedUserIds(new Set());
        return;
      }

      toast.error(
        `${action === "assign" ? "Assigned" : "Removed"} for ${successCount} user${successCount === 1 ? "" : "s"}. ${failureCount} failed.`,
        { id: t }
      );
      setSelectedUserIds(new Set(failures.map((f) => f.user_id)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk course action failed", { id: t });
    } finally {
      setIsBulkApplying(false);
    }
  };

  if (isLoading) return <div className="py-10 text-center text-sm text-muted-foreground">Loading users…</div>;
  if (error) return <div className="py-10 text-center text-sm text-destructive">Error: {error.message}</div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-16">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-foreground">{title}</h2>
          <div className="mt-1 inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            <span>
              <span className="font-medium">Total:</span>{" "}
              {sortedUsers.length.toLocaleString()} user{sortedUsers.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <Button
          className="shrink-0"
          onClick={() => setIsInviteOpen(true)}
          disabled={!callerRole || (callerRole !== "super_admin" && callerRole !== "system_admin" && !isOrgAdmin)}
        >
          Invite User
        </Button>
      </div>

      {/* Toolbar */}
      <div className="mb-12">
        <div className="flex flex-col gap-3">
          {/* Mobile: search + Filters button */}
          <div className="flex items-center gap-2 lg:hidden">
            <div className="flex-1 border-b border-primary">
              <div className="relative">
                <Search className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search users…"
                  className="pl-6 border-0 rounded-none shadow-none focus-visible:ring-0 focus-visible:border-0"
                />
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setMobileFiltersMounted(true);
                setMobileFiltersOpen(true);
              }}
              className="hover:bg-primary hover:text-white hover:border-primary"
            >
              <Filter className="h-4 w-4" />
              Filters
            </Button>
          </div>

          {/* Desktop/tablet: all filters visible + wrap */}
          <div className="hidden lg:flex flex-wrap items-end gap-6">
            <div className="min-w-[260px] flex-1 lg:flex-none lg:w-[360px]">
              <div className="text-xs text-muted-foreground mb-1">Search</div>
              <div className="border-b border-primary">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search users…"
                    className="pl-6 border-0 rounded-none shadow-none focus-visible:ring-0 focus-visible:border-0"
                  />
                </div>
              </div>
            </div>

            <UnderlineDropdown
              id="role"
              label="Role"
              value={roleFilter}
              options={[
                { value: "all", label: "All Roles" },
                ...Array.from(new Set(users.map((u) => u.role)))
                  .sort((a, b) => a.localeCompare(b))
                  .map((r) => ({ value: r, label: roleLabel(r) })),
              ]}
              open={openFilterDropdown === "role"}
              onToggle={() => setOpenFilterDropdown((v) => (v === "role" ? null : "role"))}
              onSelect={(v) => {
                setRoleFilter(v as Role | "all");
                setOpenFilterDropdown(null);
              }}
              disabled={bulkMode}
            />

            <UnderlineDropdown
              id="status"
              label="Status"
              value={statusFilter}
              options={[
                { value: "all", label: "All Status" },
                { value: "active", label: "Active" },
                { value: "pending", label: "Pending" },
                { value: "disabled", label: "Disabled" },
              ]}
              open={openFilterDropdown === "status"}
              onToggle={() => setOpenFilterDropdown((v) => (v === "status" ? null : "status"))}
              onSelect={(v) => {
                setStatusFilter(v as StatusFilter);
                setOpenFilterDropdown(null);
              }}
              disabled={bulkMode}
            />

            {!isOrgAdmin && orgScopedId ? (
              <div className="min-w-[180px]">
                <div className="text-xs text-muted-foreground mb-1">Organization</div>
                <div className="border-b border-primary pb-2 text-sm text-foreground truncate">{orgScopedLabel ?? "—"}</div>
              </div>
            ) : !orgScopedId ? (
              <UnderlineDropdown
                id="organization"
                label="Organization"
                value={orgFilter as string}
                options={[
                  { value: "all", label: "All organizations" },
                  { value: "none", label: "No organization" },
                  ...orgOptions.map((o) => ({ value: o.id, label: o.label })),
                ]}
                open={openFilterDropdown === "organization"}
                onToggle={() => setOpenFilterDropdown((v) => (v === "organization" ? null : "organization"))}
                onSelect={(v) => {
                  setOrgFilter(v as OrgFilter);
                  setOpenFilterDropdown(null);
                }}
                disabled={!canManageOrgs || bulkMode}
              />
            ) : null}

            <div className="flex items-center gap-2 pb-2">
              <Button
                variant="outline"
                onClick={clearFilters}
                disabled={bulkMode || activeChips.length === 0}
                className="hover:bg-primary hover:text-white hover:border-primary"
              >
                Clear
              </Button>
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
                <span className="truncate max-w-[280px]">{c.label}</span>
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Bulk bar */}
      {showSelectionColumn && bulkMode ? (
        <>
          {/* Mobile/tablet (<1024px): inline bulk bar (below search/filters) */}
          <div className="lg:hidden rounded-xl border bg-background p-4 shadow-sm">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <input
                    ref={mobileSelectAllRef}
                    type="checkbox"
                    aria-label="Select all visible users"
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
                        if (nextChecked) selectableIds.forEach((id) => next.add(id));
                        else selectableIds.forEach((id) => next.delete(id));
                        return next;
                      });
                    }}
                  />
                  <div className="text-sm font-semibold">{selectedUserIds.size} selected</div>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedUserIds(new Set());
                    setBulkTargetOrgId("");
                    setBulkTargetRole("");
                    setBulkCourseId("");
                    setBulkCourseAccess("unlimited");
                  }}
                  disabled={isBulkApplying}
                  className="h-9 hover:bg-primary hover:text-white hover:border-primary"
                >
                  Clear selection
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {isOrgAdmin ? (
                  <>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <FilterSelect
                        ariaLabel="Bulk role"
                        value={(bulkTargetRole || "") as string}
                        onChange={(v) => setBulkTargetRole(v as Role | "")}
                        disabled={isBulkApplying}
                        className="w-full"
                        options={[
                          { value: "", label: "Set role…" },
                          { value: "organization_admin", label: roleLabel("organization_admin") },
                          { value: "member", label: roleLabel("member") },
                        ]}
                      />
                      <Button
                        className="w-full"
                        disabled={!bulkTargetRole || isBulkApplying}
                        onClick={async () => {
                          if (!bulkTargetRole) return;
                          if (selectedUserIds.size === 0) return;
                          const ok = confirm(
                            `Change role for ${selectedUserIds.size} user${selectedUserIds.size === 1 ? "" : "s"} to "${roleLabel(
                              bulkTargetRole as Role
                            )}"?`
                          );
                          if (!ok) return;

                          setIsBulkApplying(true);
                          const t = toast.loading("Updating roles…");
                          const failures: string[] = [];
                          try {
                            const ids = Array.from(selectedUserIds);
                            for (const id of ids) {
                              try {
                                await changeUserRole(id, bulkTargetRole as Role);
                              } catch {
                                failures.push(id);
                              }
                            }

                            if (failures.length === 0) {
                              toast.success(`Updated role for ${ids.length} user${ids.length === 1 ? "" : "s"}.`, { id: t });
                              setSelectedUserIds(new Set());
                              setBulkTargetRole("");
                            } else {
                              const successCount = ids.length - failures.length;
                              toast.error(
                                `Updated ${successCount} user${successCount === 1 ? "" : "s"}. ${failures.length} failed.`,
                                { id: t }
                              );
                              setSelectedUserIds(new Set(failures));
                            }
                          } finally {
                            setIsBulkApplying(false);
                          }
                        }}
                      >
                        Update roles
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4 sm:col-span-2">
                      <FilterSelect
                        ariaLabel="Bulk course assignment"
                        value={(bulkCourseId || "") as string}
                        onChange={(v) => setBulkCourseId(v)}
                        disabled={isBulkApplying || isAssignableCoursesLoading}
                        className="w-full"
                        options={[
                          { value: "", label: isAssignableCoursesLoading ? "Loading courses…" : "Select course…" },
                          ...assignableCourses.map((c) => ({
                            value: c.id,
                            label: `${(c.title ?? "").trim() || "(untitled)"}${c.is_published ? "" : " (draft)"}`,
                          })),
                        ]}
                      />
                      <FilterSelect
                        ariaLabel="Bulk course access duration"
                        value={bulkCourseAccess}
                        onChange={(v) => setBulkCourseAccess(v as AccessDurationKey)}
                        disabled={isBulkApplying}
                        className="w-full"
                        options={ACCESS_DURATION_KEYS.map((k) => ({ value: k, label: accessKeyLabel(k) }))}
                      />
                      <Button
                        className="w-full"
                        variant="outline"
                        disabled={!bulkCourseId || isBulkApplying}
                        onClick={() => void handleBulkCourseAction("assign")}
                      >
                        Assign selected
                      </Button>
                      <Button
                        className="w-full"
                        variant="outline"
                        disabled={!bulkCourseId || isBulkApplying}
                        onClick={() => void handleBulkCourseAction("remove")}
                      >
                        Remove selected
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <FilterSelect
                      ariaLabel="Bulk target organization"
                      value={(bulkTargetOrgId || "") as string}
                      onChange={(v) => setBulkTargetOrgId(v)}
                      disabled={isBulkApplying}
                      className="w-full"
                      options={[
                        { value: "", label: "Select target organization…" },
                        ...(organizations ?? []).map((o) => {
                          const { label, inactive } = resolveOrgLabel(o);
                          return { value: o.id, label: inactive ? `${label} (inactive)` : label };
                        }),
                      ]}
                    />

                    <Button
                      className="w-full"
                      disabled={!bulkTargetOrgId || isBulkApplying}
                      onClick={() => {
                        if (!bulkTargetOrgId) return;
                        setBulkConfirmOpen(true);
                      }}
                    >
                      Move selected
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Desktop (>=1024px): inline bulk bar */}
          <div className="hidden lg:block rounded-xl border bg-background p-4 shadow-sm">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="text-sm font-medium">{selectedUserIds.size} selected</div>
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                {isOrgAdmin ? (
                  <FilterSelect
                    ariaLabel="Bulk role"
                    value={(bulkTargetRole || "") as string}
                    onChange={(v) => setBulkTargetRole(v as Role | "")}
                    disabled={isBulkApplying}
                    className="min-w-[220px]"
                    options={[
                      { value: "", label: "Set role…" },
                      { value: "organization_admin", label: roleLabel("organization_admin") },
                      { value: "member", label: roleLabel("member") },
                    ]}
                  />
                ) : (
                  <FilterSelect
                    ariaLabel="Bulk target organization"
                    value={(bulkTargetOrgId || "") as string}
                    onChange={(v) => setBulkTargetOrgId(v)}
                    disabled={isBulkApplying}
                    className="min-w-[260px]"
                    options={[
                      { value: "", label: "Select target organization…" },
                      ...(organizations ?? []).map((o) => {
                        const { label, inactive } = resolveOrgLabel(o);
                        return { value: o.id, label: inactive ? `${label} (inactive)` : label };
                      }),
                    ]}
                  />
                )}

                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedUserIds(new Set());
                    setBulkTargetOrgId("");
                    setBulkTargetRole("");
                    setBulkCourseId("");
                    setBulkCourseAccess("unlimited");
                  }}
                  disabled={isBulkApplying}
                  className="hover:bg-primary hover:text-white hover:border-primary"
                >
                  Clear selection
                </Button>

                {isOrgAdmin ? (
                  <>
                    <Button
                      disabled={!bulkTargetRole || isBulkApplying}
                      onClick={async () => {
                        if (!bulkTargetRole) return;
                        if (selectedUserIds.size === 0) return;
                        const ok = confirm(
                          `Change role for ${selectedUserIds.size} user${selectedUserIds.size === 1 ? "" : "s"} to "${roleLabel(
                            bulkTargetRole as Role
                          )}"?`
                        );
                        if (!ok) return;

                        setIsBulkApplying(true);
                        const t = toast.loading("Updating roles…");
                        const failures: string[] = [];
                        try {
                          const ids = Array.from(selectedUserIds);
                          for (const id of ids) {
                            try {
                              await changeUserRole(id, bulkTargetRole as Role);
                            } catch {
                              failures.push(id);
                            }
                          }

                          if (failures.length === 0) {
                            toast.success(`Updated role for ${ids.length} user${ids.length === 1 ? "" : "s"}.`, { id: t });
                            setSelectedUserIds(new Set());
                            setBulkTargetRole("");
                          } else {
                            const successCount = ids.length - failures.length;
                            toast.error(
                              `Updated ${successCount} user${successCount === 1 ? "" : "s"}. ${failures.length} failed.`,
                              { id: t }
                            );
                            setSelectedUserIds(new Set(failures));
                          }
                        } finally {
                          setIsBulkApplying(false);
                        }
                      }}
                    >
                      Update roles
                    </Button>

                    <FilterSelect
                      ariaLabel="Bulk course assignment"
                      value={(bulkCourseId || "") as string}
                      onChange={(v) => setBulkCourseId(v)}
                      disabled={isBulkApplying || isAssignableCoursesLoading}
                      className="min-w-[260px]"
                      options={[
                        { value: "", label: isAssignableCoursesLoading ? "Loading courses…" : "Select course…" },
                        ...assignableCourses.map((c) => ({
                          value: c.id,
                          label: `${(c.title ?? "").trim() || "(untitled)"}${c.is_published ? "" : " (draft)"}`,
                        })),
                      ]}
                    />
                    <FilterSelect
                      ariaLabel="Bulk course access duration"
                      value={bulkCourseAccess}
                      onChange={(v) => setBulkCourseAccess(v as AccessDurationKey)}
                      disabled={isBulkApplying}
                      className="min-w-[180px]"
                      options={ACCESS_DURATION_KEYS.map((k) => ({ value: k, label: accessKeyLabel(k) }))}
                    />
                    <Button
                      variant="outline"
                      disabled={!bulkCourseId || isBulkApplying}
                      onClick={() => void handleBulkCourseAction("assign")}
                    >
                      Assign selected
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!bulkCourseId || isBulkApplying}
                      onClick={() => void handleBulkCourseAction("remove")}
                    >
                      Remove selected
                    </Button>
                  </>
                ) : (
                  <Button
                    disabled={!bulkTargetOrgId || isBulkApplying}
                    onClick={() => {
                      if (!bulkTargetOrgId) return;
                      setBulkConfirmOpen(true);
                    }}
                  >
                    Move selected
                  </Button>
                )}
              </div>
            </div>
          </div>
        </>
      ) : null}

      {/* Invite form */}
      {isInviteOpen ? (
        <div className="rounded-lg border bg-background p-4 shadow-sm">
          <h3 className="text-lg font-semibold">Invite user</h3>
          <div className="mt-3">
            <UserForm
              initialData={orgScopedId ? { organization_id: orgScopedId } : undefined}
              organizationLabel={orgScopedLabel ?? undefined}
              enableOrgPicker={!orgScopedId && !isOrgAdmin}
              allowedRoles={
                isOrgAdmin
                  ? ["member"]
                  : callerRole === "system_admin"
                    ? ["organization_admin"]
                    : ["system_admin", "organization_admin", "member"]
              }
              onSubmit={handleInviteUser}
              onCancel={() => setIsInviteOpen(false)}
            />
          </div>
        </div>
      ) : null}

      {/* Desktop table */}
      <div className="hidden lg:block rounded-md border bg-background overflow-hidden shadow-sm">
        <div className="w-full overflow-hidden">
          <table className="w-full">
            <thead className="bg-background border-b">
              <tr>
                {showSelectionColumn ? (
                  <th className="px-4 py-5 text-left text-xs font-medium text-muted-foreground w-10">
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
                          if (nextChecked) selectableIds.forEach((id) => next.add(id));
                          else selectableIds.forEach((id) => next.delete(id));
                          return next;
                        });
                      }}
                    />
                  </th>
                ) : null}
                <th className="px-4 py-5 text-left text-md font-medium text-muted-foreground">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
                    onClick={() => toggleSort("name")}
                  >
                    User
                    {sortIcon("name")}
                  </button>
                </th>
                <th className="px-4 py-5 text-left text-md font-medium text-muted-foreground">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
                    onClick={() => toggleSort("role")}
                  >
                    Role
                    {sortIcon("role")}
                  </button>
                </th>
                {!orgScopedId ? (
                  <th className="px-4 py-5 text-left text-md font-medium text-muted-foreground">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
                      onClick={() => toggleSort("organization")}
                    >
                      Organization
                      {sortIcon("organization")}
                    </button>
                  </th>
                ) : null}
                <th className="px-4 py-5 text-left text-md font-medium text-muted-foreground">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
                    onClick={() => toggleSort("status")}
                  >
                    Status
                    {sortIcon("status")}
                  </button>
                </th>
                <th className="px-4 py-5 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {sortedUsers.length === 0 ? (
                <tr>
                  <td
                    colSpan={4 + (showSelectionColumn ? 1 : 0) + (orgScopedId ? 0 : 1)}
                    className="px-4 py-10 text-center text-sm text-muted-foreground"
                  >
                    No users found.
                  </td>
                </tr>
              ) : (
                sortedUsers.map((u) => {
                  const orgInfo = resolveOrgForUser(u);
                  const selectable = showSelectionColumn && (u.role === "member" || u.role === "organization_admin");
                  const name = u.full_name && String(u.full_name).trim().length ? String(u.full_name).trim() : "—";
                  const avatarUrl = typeof u.avatar_url === "string" && u.avatar_url.trim().length ? u.avatar_url.trim() : null;
                  const avatarBroken = brokenAvatarIds.has(u.id);
                  const rowSelected = selectedUserIds.has(u.id);
                  const rowText = rowSelected ? "text-white" : "text-foreground group-hover:text-white";
                  const rowMuted = rowSelected ? "text-white/80" : "text-muted-foreground group-hover:text-white/80";

                  return (
                    <tr
                      key={u.id}
                      className={`group transition-colors cursor-pointer hover:bg-primary/90 hover:text-white ${
                        rowSelected ? "bg-primary/90 text-white" : ""
                      }`}
                      onClick={() => {
                        setActiveUserId(u.id);
                        setDrawerMounted(true);
                        setDrawerOpen(true);
                      }}
                    >
                      {showSelectionColumn ? (
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          {selectable ? (
                            <input
                              type="checkbox"
                              checked={selectedUserIds.has(u.id)}
                              className={`h-4 w-4 rounded border hover:cursor-pointer bg-transparent ${
                                rowSelected ? "border-white" : "border-gray-300 group-hover:border-white"
                              }`}
                              style={{
                                accentColor: "color-mix(in srgb, var(--brand-primary) 95%, transparent)",
                              }}
                              onChange={(e) => {
                                const nextSelected = e.target.checked;
                                setSelectedUserIds((prev) => {
                                  const next = new Set(prev);
                                  if (nextSelected) next.add(u.id);
                                  else next.delete(u.id);
                                  return next;
                                });
                              }}
                            />
                          ) : (
                            <span className={`text-xs ${rowMuted}`}>—</span>
                          )}
                        </td>
                      ) : null}

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          {avatarUrl && !avatarBroken ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={avatarUrl}
                              alt=""
                              className={`h-9 w-9 shrink-0 rounded-full border object-cover ${
                                rowSelected ? "border-white/60 bg-white/10" : "border-input bg-muted group-hover:border-white/60 group-hover:bg-white/10"
                              }`}
                              onError={() => {
                                setBrokenAvatarIds((prev) => {
                                  const next = new Set(prev);
                                  next.add(u.id);
                                  return next;
                                });
                              }}
                            />
                          ) : (
                            <div
                              className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold ${
                                rowSelected ? "bg-white/15 text-white" : "bg-muted text-foreground group-hover:bg-white/15 group-hover:text-white"
                              }`}
                            >
                              {getInitials(u)}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className={`font-medium truncate ${rowText}`}>
                              {name}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <span className={`text-sm ${rowText}`}>{roleLabel(u.role)}</span>
                      </td>

                      {!orgScopedId ? (
                        <td className="px-4 py-3">
                          {orgInfo ? (
                            <OrgChip label={orgInfo.label} inactive={orgInfo.inactive} className={rowText} />
                          ) : (
                            <span className={`text-xs ${rowMuted}`}>No org</span>
                          )}
                        </td>
                      ) : null}

                      <td className="px-4 py-3">
                        <StatusPill
                          user={u}
                          className={
                            rowSelected
                              ? "bg-white/15 text-white"
                              : "group-hover:bg-white/15 group-hover:text-white"
                          }
                        />
                      </td>

                      <td className="px-4 py-3 text-right">
                        <ChevronRight className={`h-4 w-4 ${rowMuted}`} />
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
        {sortedUsers.length === 0 ? (
          <div className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">No users found.</div>
        ) : (
          sortedUsers.map((u) => (
            <MobileUserCard
              key={u.id}
              user={u}
              callerRole={callerRole}
              organizations={organizations ?? []}
              orgScopedId={orgScopedId}
              orgScopedLabel={orgScopedLabel}
              bulkMode={bulkMode}
              canSelect={showSelectionColumn && (u.role === "member" || u.role === "organization_admin")}
              isSelected={selectedUserIds.has(u.id)}
              open={openMobileUserId === u.id}
              onToggleOpen={(nextOpen) => setOpenMobileUserId(nextOpen ? u.id : null)}
              onToggleSelect={(nextSelected) => {
                setSelectedUserIds((prev) => {
                  const next = new Set(prev);
                  if (nextSelected) next.add(u.id);
                  else next.delete(u.id);
                  return next;
                });
              }}
              onChangeRole={async (userId, newRole) => {
                const res = await changeUserRole(userId, newRole);
                return { message: res.message };
              }}
              onAssignOrganization={async (userId, orgId) => {
                const res = await assignOrganization(userId, orgId);
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
              onDelete={async (userId) => {
                const res = await deleteUser(userId);
                return { message: res.message };
              }}
              onResendInvite={async (userId) => {
                const res = await resendInvite(userId);
                return { message: res.message };
              }}
              onPasswordSetupLink={async (userId) => {
                const res = await sendPasswordSetupLink(userId);
                return { message: res.message };
              }}
              assignableCourses={assignableCourses}
              assignableCoursesLoading={isAssignableCoursesLoading}
              onLoadCourseAssignments={loadUserCourseAssignments}
              onSaveCourseAssignments={saveUserCourseAssignments}
            />
          ))
        )}
      </div>

      {/* Desktop drawer */}
      {drawerMounted && activeUser ? (
        <UserDetailsDrawer
          open={drawerOpen}
          user={activeUser}
          callerRole={callerRole}
          organizations={organizations ?? []}
          orgScopedId={orgScopedId}
          orgScopedLabel={orgScopedLabel}
          onClose={() => setDrawerOpen(false)}
          onChangeRole={async (userId, newRole) => {
            const res = await changeUserRole(userId, newRole);
            return { message: res.message };
          }}
          onAssignOrganization={async (userId, orgId) => {
            const res = await assignOrganization(userId, orgId);
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
          onDelete={async (userId) => {
            const res = await deleteUser(userId);
            return { message: res.message };
          }}
          onResendInvite={async (userId) => {
            const res = await resendInvite(userId);
            return { message: res.message };
          }}
          onPasswordSetupLink={async (userId) => {
            const res = await sendPasswordSetupLink(userId);
            return { message: res.message };
          }}
          assignableCourses={assignableCourses}
          assignableCoursesLoading={isAssignableCoursesLoading}
          onLoadCourseAssignments={loadUserCourseAssignments}
          onSaveCourseAssignments={saveUserCourseAssignments}
        />
      ) : null}

      {/* Mobile filter sheet */}
      {mobileFiltersMounted ? (
        <MobileFilterSheet
          open={mobileFiltersOpen}
          callerCanManageOrgs={canManageOrgs}
          hideOrganizationFilter={isOrgAdmin || (!!orgScopedId && !isOrgAdmin)}
          organizationLabel={isOrgAdmin ? null : orgScopedLabel}
          orgOptions={orgOptions}
          roleOptions={Array.from(new Set(users.map((u) => u.role))).sort((a, b) => a.localeCompare(b))}
          roleFilter={roleFilter}
          statusFilter={statusFilter}
          orgFilter={orgFilter}
          onChangeRoleFilter={setRoleFilter}
          onChangeStatusFilter={setStatusFilter}
          onChangeOrgFilter={setOrgFilter}
          onClear={clearFilters}
          onClose={() => setMobileFiltersOpen(false)}
        />
      ) : null}

      {/* Bulk confirm modal */}
      {!isOrgAdmin ? (
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
                toast.success(`Moved ${result.successCount} user${result.successCount === 1 ? "" : "s"}.`);
                setSelectedUserIds(new Set());
                setBulkTargetOrgId("");
                setBulkConfirmOpen(false);
                return;
              }

              toast.error(
                `Moved ${result.successCount} user${result.successCount === 1 ? "" : "s"}. ` +
                  `${result.failureCount} failed. The failed users remain selected so you can retry.`
              );
              setSelectedUserIds(new Set(result.failures.map((f) => f.userId)));
              setBulkConfirmOpen(false);
            } finally {
              setIsBulkApplying(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function UserDetailsDrawer(props: {
  open: boolean;
  user: ApiUser;
  callerRole: Role | null;
  organizations: Organization[];
  orgScopedId?: string | null;
  orgScopedLabel?: string | null;
  onClose: () => void;
  onChangeRole: (userId: string, newRole: Role) => Promise<{ message?: string }>;
  onAssignOrganization: (userId: string, orgId: string) => Promise<{ message?: string }>;
  onDisable: (userId: string) => Promise<{ message?: string }>;
  onEnable: (userId: string) => Promise<{ message?: string }>;
  onDelete: (userId: string) => Promise<{ message?: string }>;
  onResendInvite: (userId: string) => Promise<{ message?: string }>;
  onPasswordSetupLink: (userId: string) => Promise<{ message?: string }>;
  assignableCourses: AssignableCourse[];
  assignableCoursesLoading: boolean;
  onLoadCourseAssignments: (userId: string) => Promise<{ assignments: CourseAssignmentInfo[] }>;
  onSaveCourseAssignments: (
    userId: string,
    assignments: Array<{ course_id: string; access: AccessDurationKey }>
  ) => Promise<{ message?: string; assignments?: Array<{ course_id: string; access_expires_at: string | null; access_duration_key: string | null }> }>;
}) {
  const {
    user,
    callerRole,
    organizations,
    onClose,
    open,
    assignableCourses,
    assignableCoursesLoading,
    onLoadCourseAssignments,
    onSaveCourseAssignments,
  } = props;
  const [selectedRole, setSelectedRole] = useState<Role>(user.role);
  const [selectedOrgId, setSelectedOrgId] = useState<string>(user.organization_id ?? "");
  const [isSavingRole, setIsSavingRole] = useState(false);
  const [isSavingOrg, setIsSavingOrg] = useState(false);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [isSavingCourses, setIsSavingCourses] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [entered, setEntered] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [baselineCourseIds, setBaselineCourseIds] = useState<Set<string>>(new Set());
  const [selectedCourseIds, setSelectedCourseIds] = useState<Set<string>>(new Set());
  const [baselineCourseAccessById, setBaselineCourseAccessById] = useState<Record<string, AccessDurationKey>>({});
  const [selectedCourseAccessById, setSelectedCourseAccessById] = useState<Record<string, AccessDurationKey>>({});
  const [baselineCourseExpiresAtById, setBaselineCourseExpiresAtById] = useState<Record<string, string | null>>({});

  useEffect(() => setSelectedRole(user.role), [user.role]);
  useEffect(() => setSelectedOrgId(user.organization_id ?? ""), [user.organization_id]);
  useEffect(() => {
    setBaselineCourseIds(new Set());
    setSelectedCourseIds(new Set());
    setBaselineCourseAccessById({});
    setSelectedCourseAccessById({});
    setBaselineCourseExpiresAtById({});
  }, [user.id]);

  const canEdit = canEditRole(callerRole, user.role);
  const canOrg = canAssignOrg(callerRole, user.role);
  const canSetup = canSendSetupLink(callerRole, user.role);
  const canDelete = canDeleteUser(callerRole, user.role);
  const canManageCourseAccess = callerRole === "organization_admin" && user.role === "member";

  const isEnabled = user.is_active !== false;
  const isPending = isEnabled && user.onboarding_status === "pending";
  const canResend = isPending || (!!user.invited_at && !user.activated_at);

  const org =
    props.orgScopedId && props.orgScopedLabel
      ? organizations.find((o) => o.id === props.orgScopedId) ?? null
      : user.organization_id
        ? organizations.find((o) => o.id === user.organization_id) ?? null
        : null;
  const orgInfo =
    props.orgScopedId && props.orgScopedLabel
      ? { label: props.orgScopedLabel, inactive: false }
      : org
        ? resolveOrgLabel(org)
        : null;
  const avatarUrl = typeof user.avatar_url === "string" && user.avatar_url.trim().length ? user.avatar_url.trim() : null;

  useEffect(() => setAvatarError(false), [user.id, avatarUrl]);

  useEffect(() => {
    if (!canManageCourseAccess || !open) {
      setBaselineCourseIds(new Set());
      setSelectedCourseIds(new Set());
      setBaselineCourseAccessById({});
      setSelectedCourseAccessById({});
      setBaselineCourseExpiresAtById({});
      return;
    }
    let cancelled = false;
    const loadAssignments = async () => {
      setIsLoadingCourses(true);
      try {
        const res = await onLoadCourseAssignments(user.id);
        if (cancelled) return;
        const list = Array.isArray(res.assignments) ? res.assignments : [];
        const ids = new Set(list.map((a) => a.course_id));
        const accessById: Record<string, AccessDurationKey> = {};
        const expiresById: Record<string, string | null> = {};
        for (const a of list) {
          accessById[a.course_id] = a.access;
          expiresById[a.course_id] = a.access_expires_at ?? null;
        }
        setBaselineCourseIds(ids);
        setSelectedCourseIds(new Set(ids));
        setBaselineCourseAccessById(accessById);
        setSelectedCourseAccessById({ ...accessById });
        setBaselineCourseExpiresAtById(expiresById);
      } catch (e) {
        if (cancelled) return;
        toast.error(e instanceof Error ? e.message : "Failed to load course assignments");
      } finally {
        if (!cancelled) setIsLoadingCourses(false);
      }
    };
    void loadAssignments();
    return () => {
      cancelled = true;
    };
  }, [canManageCourseAccess, onLoadCourseAssignments, open, user.id]);

  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), 0);
    return () => window.clearTimeout(t);
  }, []);

  const show = open && entered;

  const statusText = !isEnabled ? "Disabled" : isPending ? "Pending" : "Active";
  const statusTone = !isEnabled ? "text-gray-700" : isPending ? "text-amber-800" : "text-emerald-700";
  const orgCreated = org?.created_at ?? null;
  const courseAssignmentsDirty =
    !areStringSetsEqual(selectedCourseIds, baselineCourseIds) ||
    !areCourseAccessMapsEqualForSet(selectedCourseIds, selectedCourseAccessById, baselineCourseAccessById);

  return (
    <div
      className="fixed inset-0 z-100000"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
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
        {/* Modal header */}
        <div className="h-16 px-6 flex items-center justify-between">
          <div className="text-md font-semibold text-foreground bg-muted-foreground/10 rounded-md px-6 py-2">User Details</div>
          <button
            type="button"
            aria-label="Close"
            className="inline-flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b" />

        {/* Content */}
        <div className="flex-1 overflow-auto px-6 py-6 space-y-6">
          {/* Summary section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl bg-muted/30 border p-5">
              <div className="flex items-center justify-start">
                <div className="h-16 w-16 rounded-full bg-background border flex items-center justify-center">
                  {avatarUrl && !avatarError ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarUrl}
                      alt=""
                      className="h-16 w-16 rounded-full object-cover"
                      onError={() => setAvatarError(true)}
                    />
                  ) : (
                    <div className="h-16 w-16 rounded-full flex items-center justify-center text-sm font-semibold bg-muted text-foreground">
                      {getInitials(user)}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 text-left">
                <div className="inline-flex flex-wrap items-center justify-start gap-2">
                  <div className="text-lg font-semibold text-primary">
                    {user.full_name && String(user.full_name).trim().length ? String(user.full_name).trim() : user.email}
                  </div>
                  <div className={`inline-flex items-center gap-1.5 text-sm ${statusTone}`}>
                    <CheckCheck className="h-4 w-4" />
                    <span className="font-medium">{statusText}</span>
                  </div>
                </div>
                <div className="mt-2 text-md text-muted-foreground">{roleLabel(user.role)}</div>
              </div>
            </div>

            <div className="rounded-xl border bg-background p-5">
              <div className="space-y-3 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-4 w-4" />
                    Email
                  </span>
                  <span className="text-foreground text-right break-all">{user.email}</span>
                </div>

                <div className="flex items-start justify-between gap-4">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-4 w-4" />
                    Organization
                  </span>
                  <span className="text-foreground text-right">{orgInfo ? orgInfo.label : "No organization"}</span>
                </div>

                {orgCreated ? (
                  <div className="flex items-start justify-between gap-4">
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                      <CalendarDays className="h-4 w-4" />
                      Org created
                    </span>
                    <span className="text-foreground text-right">{formatIso(orgCreated)}</span>
                  </div>
                ) : null}

              </div>
            </div>
          </div>

          <div className="border-t" />

          {/* Lifecycle */}
          <div className="space-y-3">
            <div className="text-xl font-semibold text-foreground">Lifecycle</div>
            <div className="rounded-xl border bg-background p-5">
              <div className="space-y-3 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <CalendarDays className="h-4 w-4" />
                    User created
                  </span>
                  <span className="text-foreground text-right">{formatIso(user.created_at)}</span>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Send className="h-4 w-4" />
                    Invited
                  </span>
                  <span className="text-foreground text-right">{formatIso(user.invited_at)}</span>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <CheckCheck className="h-4 w-4" />
                    Activated
                  </span>
                  <span className="text-foreground text-right">{formatIso(user.activated_at)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t" />

          {/* Access & assignment */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xl font-semibold text-foreground">Access & assignment</div>
            </div>
            <div className="rounded-xl border bg-background p-5">
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Role</label>
                  {user.role === "super_admin" ? (
                    <div className="text-sm text-muted-foreground">Protected user</div>
                  ) : !canEdit ? (
                    <div className="text-sm">{roleLabel(user.role)}</div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <select
                          value={selectedRole}
                          onChange={(e) => setSelectedRole(e.target.value as Role)}
                          className="h-10 w-full appearance-none rounded-md border bg-background px-3 pr-10 text-sm hover:cursor-pointer disabled:opacity-60"
                          disabled={isSavingRole}
                        >
                          {allowedRoleOptions(callerRole).map((r) => (
                            <option key={r} value={r}>
                              {roleLabel(r)}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-[7px] top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      </div>
                      <Button
                        variant="outline"
                        disabled={isSavingRole || selectedRole === user.role}
                        onClick={async () => {
                          if (selectedRole === user.role) return;
                          setIsSavingRole(true);
                          const t = toast.loading("Saving role…");
                          try {
                            const res = await props.onChangeRole(user.id, selectedRole);
                            toast.success(res.message || "Role updated.", { id: t });
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Failed to update role", { id: t });
                          } finally {
                            setIsSavingRole(false);
                          }
                        }}
                      >
                        Save
                      </Button>
                    </div>
                  )}
                  <HelpText>
                    Controls what the user can access in the app. Changes take effect after you click Save.
                  </HelpText>
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Organization</label>
                  {!canOrg ? (
                    <div className="text-sm text-muted-foreground">{orgInfo ? orgInfo.label : "No organization"}</div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <select
                          value={selectedOrgId}
                          onChange={(e) => setSelectedOrgId(e.target.value)}
                          className="h-10 w-full appearance-none rounded-md border bg-background px-3 pr-10 text-sm hover:cursor-pointer disabled:opacity-60"
                          disabled={isSavingOrg}
                        >
                          <option value="">No organization</option>
                          {organizations.map((o) => {
                            const { label, inactive } = resolveOrgLabel(o);
                            return (
                              <option key={o.id} value={o.id}>
                                {inactive ? `${label} (inactive)` : label}
                              </option>
                            );
                          })}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-[7px] top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      </div>
                      <Button
                        variant="outline"
                        disabled={isSavingOrg || selectedOrgId === (user.organization_id ?? "")}
                        onClick={async () => {
                          setIsSavingOrg(true);
                          const t = toast.loading("Saving organization…");
                          try {
                            const res = await props.onAssignOrganization(user.id, selectedOrgId);
                            toast.success(res.message || "Organization updated.", { id: t });
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Failed to assign organization", { id: t });
                          } finally {
                            setIsSavingOrg(false);
                          }
                        }}
                      >
                        Save
                      </Button>
                    </div>
                  )}
                  {callerRole !== "organization_admin" && canOrg ? (
                    <HelpText>
                      Assign which organization this user belongs to. This can affect what content and data they can see.
                    </HelpText>
                  ) : null}
                </div>

                {canManageCourseAccess ? (
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Course access</label>
                    {assignableCoursesLoading || isLoadingCourses ? (
                      <div className="text-sm text-muted-foreground">Loading course access…</div>
                    ) : assignableCourses.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No courses available in this organization.</div>
                    ) : (
                      <div className="space-y-3">
                        <div className="max-h-52 overflow-auto rounded-md border p-2">
                          <div className="space-y-1">
                            {assignableCourses.map((course) => {
                              const cid = course.id;
                              const checked = selectedCourseIds.has(cid);
                              const title = (course.title ?? "").trim() || "(untitled)";
                              return (
                                <label key={cid} className="flex items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-muted/40">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 accent-primary"
                                    checked={checked}
                                    onChange={(e) => {
                                      const nextChecked = e.target.checked;
                                      setSelectedCourseIds((prev) => {
                                        const next = new Set(prev);
                                        if (nextChecked) next.add(cid);
                                        else next.delete(cid);
                                        return next;
                                      });
                                      setSelectedCourseAccessById((prev) => {
                                        const next = { ...prev };
                                        if (nextChecked) {
                                          next[cid] = prev[cid] ?? baselineCourseAccessById[cid] ?? "unlimited";
                                        } else {
                                          delete next[cid];
                                        }
                                        return next;
                                      });
                                    }}
                                  />
                                  <span className="truncate">{title}</span>
                                  <span className="ml-auto flex items-center gap-2">
                                    {checked ? (
                                      <>
                                        {baselineCourseExpiresAtById[cid] ? (
                                          <span className="hidden sm:inline text-[10px] text-muted-foreground">
                                            {(() => {
                                              const iso = baselineCourseExpiresAtById[cid];
                                              if (!iso) return "";
                                              const ms = new Date(iso).getTime();
                                              const expired = Number.isFinite(ms) ? ms <= Date.now() : false;
                                              return `${expired ? "Expired" : "Expires"} ${formatShortDate(iso)}`;
                                            })()}
                                          </span>
                                        ) : (
                                          <span className="hidden sm:inline text-[10px] text-muted-foreground">Unlimited</span>
                                        )}
                                        <select
                                          value={selectedCourseAccessById[cid] ?? "unlimited"}
                                          onClick={(e) => e.stopPropagation()}
                                          onChange={(e) => {
                                            const v = e.target.value as AccessDurationKey;
                                            setSelectedCourseAccessById((prev) => ({ ...prev, [cid]: v }));
                                          }}
                                          className="h-8 rounded-md border bg-background px-2 text-xs hover:cursor-pointer"
                                        >
                                          {ACCESS_DURATION_KEYS.map((k) => (
                                            <option key={k} value={k}>
                                              {accessKeyLabel(k)}
                                            </option>
                                          ))}
                                        </select>
                                      </>
                                    ) : null}
                                    {course.is_published ? null : (
                                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">
                                        Draft
                                      </span>
                                    )}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            disabled={isSavingCourses || !courseAssignmentsDirty}
                            onClick={async () => {
                              setIsSavingCourses(true);
                              const t = toast.loading("Saving course access…");
                              try {
                                const ids = Array.from(selectedCourseIds).sort();
                                const assignments = ids.map((course_id) => ({
                                  course_id,
                                  access: selectedCourseAccessById[course_id] ?? "unlimited",
                                }));
                                const res = await onSaveCourseAssignments(user.id, assignments);
                                const nextIds = new Set(ids);
                                const nextAccess = { ...selectedCourseAccessById };
                                setBaselineCourseIds(nextIds);
                                setBaselineCourseAccessById(nextAccess);
                                setBaselineCourseExpiresAtById(() => {
                                  const next: Record<string, string | null> = {};
                                  for (const a of assignments) {
                                    const row = res.assignments?.find((x) => x.course_id === a.course_id) ?? null;
                                    next[a.course_id] = row?.access_expires_at ?? null;
                                  }
                                  return next;
                                });
                                toast.success(res.message || "Course access updated.", { id: t });
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Failed to save course access", { id: t });
                              } finally {
                                setIsSavingCourses(false);
                              }
                            }}
                          >
                            Save
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={isSavingCourses || !courseAssignmentsDirty}
                            onClick={() => {
                              setSelectedCourseIds(new Set(baselineCourseIds));
                              setSelectedCourseAccessById({ ...baselineCourseAccessById });
                            }}
                          >
                            Reset
                          </Button>
                        </div>
                      </div>
                    )}
                    <HelpText>
                      Select exactly which courses this member can see and start.
                    </HelpText>
                  </div>
                ) : null}

                <div className="flex w-full">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isSavingRole || isSavingOrg || isSavingCourses}
                    onClick={() => {
                      setSelectedRole(user.role);
                      setSelectedOrgId(user.organization_id ?? "");
                      setSelectedCourseIds(new Set(baselineCourseIds));
                      setSelectedCourseAccessById({ ...baselineCourseAccessById });
                    }}
                    className="w-full min-h-[40px] border border-primary bg-primary text-white hover:bg-white hover:text-foreground hover:border-primary"
                  >
                    Clear
                </Button>
              </div>
              <HelpText className="text-right">
                Resets unsaved Access & assignment changes (does not save).
              </HelpText>
              </div>
            </div>
          </div>

          <div className="border-t" />

          {/* Actions */}
          <div className="space-y-3">
            <div className="text-xl font-semibold text-foreground">Actions</div>
            <div className="rounded-xl border bg-background p-5">
              {user.role === "super_admin" ? (
                <div className="text-sm text-muted-foreground">This user is protected.</div>
              ) : (
                <div className="flex flex-wrap gap-4">
                  {canSetup ? (
                    <div className="flex flex-col items-start gap-1 max-w-[260px]">
                      <Button
                        variant="outline"
                        disabled={isBusy}
                        onClick={async () => {
                          setIsBusy(true);
                          const t = toast.loading("Sending setup link…");
                          try {
                            const res = await props.onPasswordSetupLink(user.id);
                            toast.success(res.message || "Setup link sent.", { id: t });
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Failed to send setup link", { id: t });
                          } finally {
                            setIsBusy(false);
                          }
                        }}
                      >
                        Reset Password
                      </Button>
                      <HelpText>
                        Sends the user a secure email link to set or reset their password and finish onboarding.
                      </HelpText>
                    </div>
                  ) : null}

                  {canResend ? (
                    <div className="flex flex-col items-start gap-1 max-w-[260px]">
                      <Button
                        variant="outline"
                        disabled={isBusy}
                        onClick={async () => {
                          setIsBusy(true);
                          const t = toast.loading("Sending setup link…");
                          try {
                            const res = await props.onResendInvite(user.id);
                            toast.success(res.message || "Password setup link sent.", { id: t });
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Failed to send setup link", { id: t });
                          } finally {
                            setIsBusy(false);
                          }
                        }}
                      >
                        Send new setup link
                      </Button>
                      <HelpText>Sends a fresh password setup link to this user.</HelpText>
                    </div>
                  ) : null}

                  {isEnabled ? (
                    <div className="flex flex-col items-start gap-1 max-w-[260px]">
                      <Button
                        variant="destructive"
                        disabled={isBusy}
                        onClick={async () => {
                          if (!confirm("Disable this user? They will no longer be able to log in.")) return;
                          setIsBusy(true);
                          const t = toast.loading("Disabling…");
                          try {
                            const res = await props.onDisable(user.id);
                            toast.success(res.message || "User disabled.", { id: t });
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Failed to disable user", { id: t });
                          } finally {
                            setIsBusy(false);
                          }
                        }}
                      >
                        Disable
                      </Button>
                      {/* <HelpText>Prevents the user from logging in until they are enabled again.</HelpText> */}
                    </div>
                  ) : (
                    <div className="flex flex-col items-start gap-1 max-w-[260px]">
                      <Button
                        variant="outline"
                        disabled={isBusy}
                        onClick={async () => {
                          if (!confirm("Enable this user? They will be able to log in again.")) return;
                          setIsBusy(true);
                          const t = toast.loading("Enabling…");
                          try {
                            const res = await props.onEnable(user.id);
                            toast.success(res.message || "User enabled.", { id: t });
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Failed to enable user", { id: t });
                          } finally {
                            setIsBusy(false);
                          }
                        }}
                      >
                        Enable
                      </Button>
                      <HelpText>Restores access so the user can log in again.</HelpText>
                    </div>
                  )}

                  {canDelete ? (
                    <div className="flex flex-col items-start gap-1 max-w-[320px]">
                      <Button
                        variant="destructive"
                        disabled={isBusy}
                        className="bg-red-800 text-white hover:bg-red-900"
                        onClick={async () => {
                          const ok = confirm(
                            "Permanently delete this user?\n\nThis will remove them from reports/exports and scrub personal data. This cannot be undone."
                          );
                          if (!ok) return;

                          const typed = prompt('Type DELETE to confirm this deletion.', "");
                          if ((typed ?? "").trim() !== "DELETE") {
                            alert("Deletion cancelled.");
                            return;
                          }

                          setIsBusy(true);
                          const t = toast.loading("Deleting user…");
                          try {
                            const res = await props.onDelete(user.id);
                            toast.success(res.message || "User deleted.", { id: t });
                            onClose();
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Failed to delete user", { id: t });
                          } finally {
                            setIsBusy(false);
                          }
                        }}
                      >
                        Delete user
                      </Button>
                      <HelpText>
                        Requires typing <span className="font-mono">DELETE</span> to confirm. This action is irreversible.
                      </HelpText>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileFilterSheet(props: {
  open: boolean;
  callerCanManageOrgs: boolean;
  hideOrganizationFilter?: boolean;
  organizationLabel?: string | null;
  roleOptions: Role[];
  orgOptions: Array<{ id: string; label: string }>;
  roleFilter: Role | "all";
  statusFilter: StatusFilter;
  orgFilter: OrgFilter;
  onChangeRoleFilter: (v: Role | "all") => void;
  onChangeStatusFilter: (v: StatusFilter) => void;
  onChangeOrgFilter: (v: OrgFilter) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [openDropdown, setOpenDropdown] = useState<FilterDropdownId | null>(null);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!openDropdown) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) {
        setOpenDropdown(null);
        return;
      }
      const container = e.target.closest("[data-filter-dropdown]");
      const id = container?.getAttribute("data-filter-dropdown") as FilterDropdownId | null;
      if (id && id === openDropdown) return;
      setOpenDropdown(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [openDropdown]);

  // Mount hidden for 1 tick so "open" animates like "close".
  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), 0);
    return () => window.clearTimeout(t);
  }, []);

  const show = props.open && entered;

  return (
    <div className="fixed inset-0 z-100000 flex" role="dialog" aria-modal="true" onClick={props.onClose}>
      <div
        className={`absolute inset-0 bg-black/40 z-0 transition-opacity duration-200 ${show ? "opacity-100" : "opacity-0"}`}
      />
      <div
        className={`
          relative z-10 h-full w-[320px] max-w-[90vw] bg-background shadow-2xl border-r flex flex-col
          transition-transform duration-200 ease-out
          ${show ? "translate-x-0" : "-translate-x-full"}
        `}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div className="text-lg font-semibold">Filters</div>
          <button
            type="button"
            aria-label="Close"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-primary hover:text-white hover:border-primary"
            onClick={props.onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          <UnderlineDropdown
            id="role"
            label="Role"
            value={props.roleFilter}
            options={[
              { value: "all", label: "All roles" },
              ...props.roleOptions.map((r) => ({ value: r, label: roleLabel(r) })),
            ]}
            open={openDropdown === "role"}
            onToggle={() => setOpenDropdown((v) => (v === "role" ? null : "role"))}
            onSelect={(v) => {
              props.onChangeRoleFilter(v as Role | "all");
              setOpenDropdown(null);
            }}
          />

          <UnderlineDropdown
            id="status"
            label="Status"
            value={props.statusFilter}
            options={[
              { value: "all", label: "All statuses" },
              { value: "active", label: "Active" },
              { value: "pending", label: "Pending" },
              { value: "disabled", label: "Disabled" },
            ]}
            open={openDropdown === "status"}
            onToggle={() => setOpenDropdown((v) => (v === "status" ? null : "status"))}
            onSelect={(v) => {
              props.onChangeStatusFilter(v as StatusFilter);
              setOpenDropdown(null);
            }}
          />

          {props.hideOrganizationFilter ? (
            props.organizationLabel ? (
              <div className="min-w-[180px]">
                <div className="text-xs text-muted-foreground mb-1">Organization</div>
                <div className="border-b border-primary pb-2 text-sm text-foreground truncate">{props.organizationLabel}</div>
              </div>
            ) : null
          ) : (
            <UnderlineDropdown
              id="organization"
              label="Organization"
              value={props.orgFilter as string}
              options={[
                { value: "all", label: "All organizations" },
                { value: "none", label: "No organization" },
                ...props.orgOptions.map((o) => ({ value: o.id, label: o.label })),
              ]}
              open={openDropdown === "organization"}
              onToggle={() => setOpenDropdown((v) => (v === "organization" ? null : "organization"))}
              onSelect={(v) => {
                props.onChangeOrgFilter(v as OrgFilter);
                setOpenDropdown(null);
              }}
              disabled={!props.callerCanManageOrgs}
            />
          )}
        </div>

        <div className="p-5 border-t flex items-center justify-between">
          <Button variant="outline" onClick={props.onClear} className="hover:bg-primary hover:text-white hover:border-primary">
            Clear
          </Button>
          <Button onClick={props.onClose}>Apply</Button>
        </div>
      </div>
    </div>
  );
}

function MobileUserCard(props: {
  user: ApiUser;
  callerRole: Role | null;
  organizations: Organization[];
  orgScopedId?: string | null;
  orgScopedLabel?: string | null;
  bulkMode: boolean;
  canSelect: boolean;
  isSelected: boolean;
  open: boolean;
  onToggleOpen: (nextOpen: boolean) => void;
  onToggleSelect: (nextSelected: boolean) => void;
  onChangeRole: (userId: string, newRole: Role) => Promise<{ message?: string }>;
  onAssignOrganization: (userId: string, orgId: string) => Promise<{ message?: string }>;
  onDisable: (userId: string) => Promise<{ message?: string }>;
  onEnable: (userId: string) => Promise<{ message?: string }>;
  onDelete: (userId: string) => Promise<{ message?: string }>;
  onResendInvite: (userId: string) => Promise<{ message?: string }>;
  onPasswordSetupLink: (userId: string) => Promise<{ message?: string }>;
  assignableCourses: AssignableCourse[];
  assignableCoursesLoading: boolean;
  onLoadCourseAssignments: (userId: string) => Promise<{ assignments: CourseAssignmentInfo[] }>;
  onSaveCourseAssignments: (
    userId: string,
    assignments: Array<{ course_id: string; access: AccessDurationKey }>
  ) => Promise<{ message?: string; assignments?: Array<{ course_id: string; access_expires_at: string | null; access_duration_key: string | null }> }>;
}) {
  const {
    user,
    callerRole,
    organizations,
    assignableCourses,
    assignableCoursesLoading,
    onLoadCourseAssignments,
    onSaveCourseAssignments,
  } = props;
  const [avatarError, setAvatarError] = useState(false);
  const [selectedRole, setSelectedRole] = useState<Role>(user.role);
  const [selectedOrgId, setSelectedOrgId] = useState<string>(user.organization_id ?? "");
  const [baselineCourseIds, setBaselineCourseIds] = useState<Set<string>>(new Set());
  const [selectedCourseIds, setSelectedCourseIds] = useState<Set<string>>(new Set());
  const [baselineCourseAccessById, setBaselineCourseAccessById] = useState<Record<string, AccessDurationKey>>({});
  const [selectedCourseAccessById, setSelectedCourseAccessById] = useState<Record<string, AccessDurationKey>>({});
  const [baselineCourseExpiresAtById, setBaselineCourseExpiresAtById] = useState<Record<string, string | null>>({});
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [savingCourses, setSavingCourses] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savingRole, setSavingRole] = useState(false);
  const [savingOrg, setSavingOrg] = useState(false);

  useEffect(() => setSelectedRole(user.role), [user.role]);
  useEffect(() => setSelectedOrgId(user.organization_id ?? ""), [user.organization_id]);
  useEffect(() => {
    setBaselineCourseIds(new Set());
    setSelectedCourseIds(new Set());
    setBaselineCourseAccessById({});
    setSelectedCourseAccessById({});
    setBaselineCourseExpiresAtById({});
  }, [user.id]);

  const isEnabled = user.is_active !== false;
  const isPending = isEnabled && user.onboarding_status === "pending";
  const canSetup = canSendSetupLink(callerRole, user.role);
  const canResend = isPending || (!!user.invited_at && !user.activated_at);
  const canEdit = canEditRole(callerRole, user.role);
  const canOrg = canAssignOrg(callerRole, user.role);
  const canDelete = canDeleteUser(callerRole, user.role);
  const canManageCourseAccess = callerRole === "organization_admin" && user.role === "member";

  const org =
    props.orgScopedId && props.orgScopedLabel
      ? organizations.find((o) => o.id === props.orgScopedId) ?? null
      : user.organization_id
        ? organizations.find((o) => o.id === user.organization_id) ?? null
        : null;
  const orgInfo =
    props.orgScopedId && props.orgScopedLabel
      ? { label: props.orgScopedLabel, inactive: false }
      : org
        ? resolveOrgLabel(org)
        : null;
  const orgCreated = org?.created_at ?? null;
  const avatarUrl = typeof user.avatar_url === "string" && user.avatar_url.trim().length ? user.avatar_url.trim() : null;
  const selected = props.isSelected;
  const rowText = selected ? "text-white" : "text-foreground group-hover:text-white";
  const rowMuted = selected ? "text-white/80" : "text-muted-foreground group-hover:text-white/80";
  const outlineButtonClass = `border ${
    selected ? "bg-white/10 text-white border-white/30" : "bg-background/95 text-foreground border-input"
  } hover:bg-primary hover:text-white hover:border-primary`;

  const statusTone = !isEnabled ? "text-gray-100" : isPending ? "text-amber-200" : "text-emerald-200";
  const StatusIcon = !isEnabled ? X : isPending ? Send : CheckCheck;
  const open = props.open;
  const courseAssignmentsDirty =
    !areStringSetsEqual(selectedCourseIds, baselineCourseIds) ||
    !areCourseAccessMapsEqualForSet(selectedCourseIds, selectedCourseAccessById, baselineCourseAccessById);

  useEffect(() => {
    if (!canManageCourseAccess || !open) {
      setBaselineCourseIds(new Set());
      setSelectedCourseIds(new Set());
      setBaselineCourseAccessById({});
      setSelectedCourseAccessById({});
      setBaselineCourseExpiresAtById({});
      return;
    }
    let cancelled = false;
    const loadAssignments = async () => {
      setLoadingCourses(true);
      try {
        const res = await onLoadCourseAssignments(user.id);
        if (cancelled) return;
        const list = Array.isArray(res.assignments) ? res.assignments : [];
        const ids = new Set(list.map((a) => a.course_id));
        const accessById: Record<string, AccessDurationKey> = {};
        const expiresById: Record<string, string | null> = {};
        for (const a of list) {
          accessById[a.course_id] = a.access;
          expiresById[a.course_id] = a.access_expires_at ?? null;
        }
        setBaselineCourseIds(ids);
        setSelectedCourseIds(new Set(ids));
        setBaselineCourseAccessById(accessById);
        setSelectedCourseAccessById({ ...accessById });
        setBaselineCourseExpiresAtById(expiresById);
      } catch (e) {
        if (cancelled) return;
        toast.error(e instanceof Error ? e.message : "Failed to load course assignments");
      } finally {
        if (!cancelled) setLoadingCourses(false);
      }
    };
    void loadAssignments();
    return () => {
      cancelled = true;
    };
  }, [canManageCourseAccess, onLoadCourseAssignments, open, user.id]);

  return (
    <div
      className={`group rounded-lg border p-4 shadow-sm transition-colors ${
        selected ? "bg-primary/90 text-white" : "bg-background"
      } hover:bg-primary/90 hover:text-white`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex items-center gap-3">
          {avatarUrl && !avatarError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt=""
              className={`h-10 w-10 shrink-0 rounded-full border object-cover ${
                selected ? "border-white/60 bg-white/10" : "border-input bg-muted group-hover:border-white/60 group-hover:bg-white/10"
              }`}
              onError={() => setAvatarError(true)}
            />
          ) : (
            <div
              className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold ${
                selected ? "bg-white/15 text-white" : "bg-muted text-foreground group-hover:bg-white/15 group-hover:text-white"
              }`}
            >
              {getInitials(user)}
            </div>
          )}
          <div className="min-w-0">
            <div className={`font-semibold truncate ${rowText}`}>
              {user.full_name && String(user.full_name).trim().length ? String(user.full_name).trim() : "—"}
            </div>
          </div>
        </div>
        <div className="shrink-0">
          <div className="inline-flex items-center gap-2">
            <StatusIcon className={`h-4 w-4 ${selected ? "text-white" : statusTone}`} />
            <StatusPill
              user={user}
              className={selected ? "bg-white/15 text-white" : "group-hover:bg-white/15 group-hover:text-white"}
            />
          </div>
        </div>
      </div>

      {open ? (
        <>
          <div className={`mt-4 space-y-5 border-t pt-4 ${selected ? "border-white/15" : ""}`}>
            

            {/* Summary (non-redundant details) */}
            <div className={`rounded-xl border p-4 ${selected ? "border-white/15 bg-white/5" : "bg-background"}`}>
              <div className="space-y-3 text-sm">
                {/* Role + Organization (shown first on expand) */}
                <div className="flex items-start justify-between gap-4">
                  <span className={`inline-flex items-center gap-2 ${rowMuted}`}>
                    <Users className="h-4 w-4" />
                    Role
                  </span>
                  <span className={`${rowText} text-right`}>{roleLabel(user.role)}</span>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className={`inline-flex items-center gap-2 ${rowMuted}`}>
                    <Building2 className="h-4 w-4" />
                    Organization
                  </span>
                  <span className={`${rowText} text-right`}>{orgInfo ? orgInfo.label : "No organization"}</span>
                </div>
                {/* Email + Org created */}
                <div className="flex items-start justify-between gap-4">
                  <span className={`inline-flex items-center gap-2 ${rowMuted}`}>
                    <Mail className="h-4 w-4" />
                    Email
                  </span>
                  <span className={`${rowText} text-right break-all`}>{user.email}</span>
                </div>

                {orgCreated ? (
                  <div className="flex items-start justify-between gap-4">
                    <span className={`inline-flex items-center gap-2 ${rowMuted}`}>
                      <CalendarDays className="h-4 w-4" />
                      Org created
                    </span>
                    <span className={`${rowText} text-right`}>{formatIso(orgCreated)}</span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className={`border-t ${selected ? "border-white/15" : ""}`} />

          {/* Lifecycle */}
          <div className="space-y-3">
            <div className={`text-base font-semibold ${rowText}`}>Lifecycle</div>
            <div className={`rounded-xl border p-4 ${selected ? "border-white/15 bg-white/5" : "bg-background"}`}>
              <div className="space-y-3 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <span className={`inline-flex items-center gap-2 ${rowMuted}`}>
                    <CalendarDays className="h-4 w-4" />
                    User created
                  </span>
                  <span className={`${rowText} text-right`}>{formatIso(user.created_at)}</span>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className={`inline-flex items-center gap-2 ${rowMuted}`}>
                    <Send className="h-4 w-4" />
                    Invited
                  </span>
                  <span className={`${rowText} text-right`}>{formatIso(user.invited_at)}</span>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className={`inline-flex items-center gap-2 ${rowMuted}`}>
                    <CheckCheck className="h-4 w-4" />
                    Activated
                  </span>
                  <span className={`${rowText} text-right`}>{formatIso(user.activated_at)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className={`border-t ${selected ? "border-white/15" : ""}`} />

          {/* Access & assignment */}
          <div className="space-y-3">
            <div className={`text-base font-semibold ${rowText}`}>Access & assignment</div>
            <div className={`rounded-xl border p-4 ${selected ? "border-white/15 bg-white/5" : "bg-background"}`}>
              {user.role === "super_admin" ? (
                <div className={`text-sm ${rowMuted}`}>This user is protected.</div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className={`block text-xs font-medium mb-1 ${rowMuted}`}>Role</label>
                    {!canEdit ? (
                      <div className={`text-sm ${rowText}`}>{roleLabel(user.role)}</div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <select
                            value={selectedRole}
                            onChange={(e) => setSelectedRole(e.target.value as Role)}
                            className="h-10 w-full appearance-none rounded-md border bg-background px-3 pr-10 text-sm text-foreground placeholder:text-muted-foreground hover:cursor-pointer disabled:opacity-60"
                            disabled={savingRole}
                          >
                            {allowedRoleOptions(callerRole).map((r) => (
                              <option key={r} value={r}>
                                {roleLabel(r)}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-[7px] top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        </div>
                        <Button
                          variant="outline"
                          disabled={savingRole || selectedRole === user.role}
                          className={outlineButtonClass}
                          onClick={async () => {
                            if (selectedRole === user.role) return;
                            setSavingRole(true);
                            const t = toast.loading("Saving role…");
                            try {
                              const res = await props.onChangeRole(user.id, selectedRole);
                              toast.success(res.message || "Role updated.", { id: t });
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : "Failed to update role", { id: t });
                            } finally {
                              setSavingRole(false);
                            }
                          }}
                        >
                          Save
                        </Button>
                      </div>
                    )}
                    <HelpText className={selected ? "text-white/80" : ""}>
                      Controls what the user can access in the app. Changes take effect after you click Save.
                    </HelpText>
                  </div>

                  <div>
                    <label className={`block text-xs font-medium mb-1 ${rowMuted}`}>Organization</label>
                    {!canOrg ? (
                      <div className={`text-sm ${rowMuted}`}>{orgInfo ? orgInfo.label : "No organization"}</div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <select
                            value={selectedOrgId}
                            onChange={(e) => setSelectedOrgId(e.target.value)}
                            className="h-10 w-full appearance-none rounded-md border bg-background px-3 pr-10 text-sm text-foreground placeholder:text-muted-foreground hover:cursor-pointer disabled:opacity-60"
                            disabled={savingOrg}
                          >
                            <option value="">No organization</option>
                            {organizations.map((o) => {
                              const { label, inactive } = resolveOrgLabel(o);
                              return (
                                <option key={o.id} value={o.id}>
                                  {inactive ? `${label} (inactive)` : label}
                                </option>
                              );
                            })}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-[7px] top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        </div>
                        <Button
                          variant="outline"
                          disabled={savingOrg || selectedOrgId === (user.organization_id ?? "")}
                          className={outlineButtonClass}
                          onClick={async () => {
                            setSavingOrg(true);
                            const t = toast.loading("Saving organization…");
                            try {
                              const res = await props.onAssignOrganization(user.id, selectedOrgId);
                              toast.success(res.message || "Organization updated.", { id: t });
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : "Failed to assign organization", { id: t });
                            } finally {
                              setSavingOrg(false);
                            }
                          }}
                        >
                          Save
                        </Button>
                      </div>
                    )}
                    {callerRole !== "organization_admin" && canOrg ? (
                      <HelpText className={selected ? "text-white/80" : ""}>
                        Assign which organization this user belongs to. This can affect what content and data they can see.
                      </HelpText>
                    ) : null}
                  </div>

                  {canManageCourseAccess ? (
                    <div>
                      <label className={`block text-xs font-medium mb-1 ${rowMuted}`}>Course access</label>
                      {assignableCoursesLoading || loadingCourses ? (
                        <div className={`text-sm ${rowMuted}`}>Loading course access…</div>
                      ) : assignableCourses.length === 0 ? (
                        <div className={`text-sm ${rowMuted}`}>No courses available in this organization.</div>
                      ) : (
                        <div className="space-y-3">
                          <div className={`max-h-48 overflow-auto rounded-md border p-2 ${selected ? "border-white/20" : ""}`}>
                            <div className="space-y-1">
                              {assignableCourses.map((course) => {
                                const cid = course.id;
                                const checked = selectedCourseIds.has(cid);
                                const title = (course.title ?? "").trim() || "(untitled)";
                                return (
                                  <label key={cid} className="flex items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-muted/30">
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 accent-primary"
                                      checked={checked}
                                      onChange={(e) => {
                                        const nextChecked = e.target.checked;
                                        setSelectedCourseIds((prev) => {
                                          const next = new Set(prev);
                                          if (nextChecked) next.add(cid);
                                          else next.delete(cid);
                                          return next;
                                        });
                                        setSelectedCourseAccessById((prev) => {
                                          const next = { ...prev };
                                          if (nextChecked) {
                                            next[cid] = prev[cid] ?? baselineCourseAccessById[cid] ?? "unlimited";
                                          } else {
                                            delete next[cid];
                                          }
                                          return next;
                                        });
                                      }}
                                    />
                                    <span className={`truncate ${rowText}`}>{title}</span>
                                    <span className="ml-auto flex items-center gap-2">
                                      {checked ? (
                                        <>
                                          {baselineCourseExpiresAtById[cid] ? (
                                            <span className={`hidden sm:inline text-[10px] ${rowMuted}`}>
                                              {(() => {
                                                const iso = baselineCourseExpiresAtById[cid];
                                                if (!iso) return "";
                                                const ms = new Date(iso).getTime();
                                                const expired = Number.isFinite(ms) ? ms <= Date.now() : false;
                                                return `${expired ? "Expired" : "Expires"} ${formatShortDate(iso)}`;
                                              })()}
                                            </span>
                                          ) : (
                                            <span className={`hidden sm:inline text-[10px] ${rowMuted}`}>Unlimited</span>
                                          )}
                                          <select
                                            value={selectedCourseAccessById[cid] ?? "unlimited"}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => {
                                              const v = e.target.value as AccessDurationKey;
                                              setSelectedCourseAccessById((prev) => ({ ...prev, [cid]: v }));
                                            }}
                                            className="h-8 rounded-md border bg-background px-2 text-xs text-foreground hover:cursor-pointer"
                                          >
                                            {ACCESS_DURATION_KEYS.map((k) => (
                                              <option key={k} value={k}>
                                                {accessKeyLabel(k)}
                                              </option>
                                            ))}
                                          </select>
                                        </>
                                      ) : null}
                                      {course.is_published ? null : (
                                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">
                                          Draft
                                        </span>
                                      )}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              className={outlineButtonClass}
                              disabled={savingCourses || !courseAssignmentsDirty}
                              onClick={async () => {
                                setSavingCourses(true);
                                const t = toast.loading("Saving course access…");
                                try {
                                  const ids = Array.from(selectedCourseIds).sort();
                                  const assignments = ids.map((course_id) => ({
                                    course_id,
                                    access: selectedCourseAccessById[course_id] ?? "unlimited",
                                  }));
                                  const res = await onSaveCourseAssignments(user.id, assignments);
                                  const nextIds = new Set(ids);
                                  const nextAccess = { ...selectedCourseAccessById };
                                  setBaselineCourseIds(nextIds);
                                  setBaselineCourseAccessById(nextAccess);
                                  setBaselineCourseExpiresAtById(() => {
                                    const next: Record<string, string | null> = {};
                                    for (const a of assignments) {
                                      const row = res.assignments?.find((x) => x.course_id === a.course_id) ?? null;
                                      next[a.course_id] = row?.access_expires_at ?? null;
                                    }
                                    return next;
                                  });
                                  toast.success(res.message || "Course access updated.", { id: t });
                                } catch (e) {
                                  toast.error(e instanceof Error ? e.message : "Failed to save course access", { id: t });
                                } finally {
                                  setSavingCourses(false);
                                }
                              }}
                            >
                              Save
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={savingCourses || !courseAssignmentsDirty}
                              onClick={() => {
                                setSelectedCourseIds(new Set(baselineCourseIds));
                                setSelectedCourseAccessById({ ...baselineCourseAccessById });
                              }}
                              className={selected ? "text-white hover:bg-white/10 hover:text-white" : ""}
                            >
                              Reset
                            </Button>
                          </div>
                        </div>
                      )}
                      <HelpText className={selected ? "text-white/80" : ""}>
                        Select exactly which courses this member can see and start.
                      </HelpText>
                    </div>
                  ) : null}

                  <div className="flex w-full">
                    <Button
                      type="button"
                      disabled={savingRole || savingOrg || savingCourses}
                      onClick={() => {
                        setSelectedRole(user.role);
                        setSelectedOrgId(user.organization_id ?? "");
                        setSelectedCourseIds(new Set(baselineCourseIds));
                        setSelectedCourseAccessById({ ...baselineCourseAccessById });
                      }}
                      className="w-full min-h-[40px] border border-primary bg-primary text-white hover:bg-white hover:text-foreground hover:border-primary"
                    >
                      Clear
                    </Button>
                  </div>
                  <HelpText className={selected ? "text-white/80 text-right" : "text-right"}>
                    Resets unsaved Access & assignment changes (does not save).
                  </HelpText>
                </div>
              )}
            </div>
          </div>

          <div className={`border-t ${selected ? "border-white/15" : ""}`} />

          {/* Actions */}
          <div className="space-y-3">
            <div className={`text-base font-semibold ${rowText}`}>Actions</div>
            <div className={`rounded-xl border p-4 ${selected ? "border-white/15 bg-white/5" : "bg-background"}`}>
              {user.role === "super_admin" ? (
                <div className={`text-sm ${rowMuted}`}>This user is protected.</div>
              ) : (
                <div className="flex flex-wrap gap-4">
                  {canSetup ? (
                    <div className="flex flex-col items-start gap-1 max-w-[260px]">
                      <Button
                        variant="outline"
                        disabled={busy}
                        className={outlineButtonClass}
                        onClick={async () => {
                          setBusy(true);
                          const t = toast.loading("Sending setup link…");
                          try {
                            const res = await props.onPasswordSetupLink(user.id);
                            toast.success(res.message || "Setup link sent.", { id: t });
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Failed to send setup link", { id: t });
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Reset Password
                      </Button>
                      <HelpText className={selected ? "text-white/80" : ""}>
                        Sends the user a secure email link to set or reset their password and finish onboarding.
                      </HelpText>
                    </div>
                  ) : null}

                  {canResend ? (
                    <div className="flex flex-col items-start gap-1 max-w-[260px]">
                      <Button
                        variant="outline"
                        disabled={busy}
                        className={outlineButtonClass}
                        onClick={async () => {
                          setBusy(true);
                          const t = toast.loading("Sending setup link…");
                          try {
                            const res = await props.onResendInvite(user.id);
                            toast.success(res.message || "Password setup link sent.", { id: t });
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Failed to send setup link", { id: t });
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Send new setup link
                      </Button>
                      <HelpText className={selected ? "text-white/80" : ""}>Sends a fresh password setup link to this user.</HelpText>
                    </div>
                  ) : null}

                  {isEnabled ? (
                    <div className="flex flex-col items-start gap-1 max-w-[260px]">
                      <Button
                        variant="destructive"
                        disabled={busy}
                        onClick={async () => {
                          if (!confirm("Disable this user? They will no longer be able to log in.")) return;
                          setBusy(true);
                          const t = toast.loading("Disabling…");
                          try {
                            const res = await props.onDisable(user.id);
                            toast.success(res.message || "User disabled.", { id: t });
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Failed to disable user", { id: t });
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Disable
                      </Button>
                      <HelpText className={selected ? "text-white/80" : ""}>
                        Prevents the user from logging in until they are enabled again.
                      </HelpText>
                    </div>
                  ) : (
                    <div className="flex flex-col items-start gap-1 max-w-[260px]">
                      <Button
                        variant="outline"
                        disabled={busy}
                        className={outlineButtonClass}
                        onClick={async () => {
                          if (!confirm("Enable this user? They will be able to log in again.")) return;
                          setBusy(true);
                          const t = toast.loading("Enabling…");
                          try {
                            const res = await props.onEnable(user.id);
                            toast.success(res.message || "User enabled.", { id: t });
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Failed to enable user", { id: t });
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Enable
                      </Button>
                      <HelpText className={selected ? "text-white/80" : ""}>Restores access so the user can log in again.</HelpText>
                    </div>
                  )}

                  {canDelete ? (
                    <div className="flex flex-col items-start gap-1 max-w-[320px]">
                      <Button
                        variant="destructive"
                        disabled={busy}
                        className="bg-red-800 text-white hover:bg-red-900"
                        onClick={async () => {
                          const ok = confirm(
                            "Permanently delete this user?\n\nThis will remove them from reports/exports and scrub personal data. This cannot be undone."
                          );
                          if (!ok) return;

                          const typed = prompt('Type DELETE to confirm this deletion.', "");
                          if ((typed ?? "").trim() !== "DELETE") {
                            alert("Deletion cancelled.");
                            return;
                          }

                          setBusy(true);
                          const t = toast.loading("Deleting user…");
                          try {
                            const res = await props.onDelete(user.id);
                            toast.success(res.message || "User deleted.", { id: t });
                            props.onToggleOpen(false);
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Failed to delete user", { id: t });
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Delete user
                      </Button>
                      <HelpText className={selected ? "text-white/80" : ""}>
                        Requires typing <span className="font-mono">DELETE</span> to confirm. This action is irreversible.
                      </HelpText>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
          <div className={`mt-4 flex flex-wrap items-center gap-2 border-t pt-4 ${selected ? "border-white/15" : ""}`}>
            {props.canSelect ? (
              <label className={`inline-flex items-center gap-2 text-xs ${rowMuted}`}>
                <input
                  type="checkbox"
                  checked={props.isSelected}
                  className={`h-4 w-4 rounded border bg-transparent ${
                    selected ? "border-white" : "border-gray-300 group-hover:border-white"
                  }`}
                  style={{
                    accentColor: "color-mix(in srgb, var(--brand-primary) 95%, transparent)",
                  }}
                  onChange={(e) => props.onToggleSelect(e.target.checked)}
                />
                Select
              </label>
            ) : null}

            <Button
              variant="outline"
              onClick={() => props.onToggleOpen(false)}
              className={`ml-auto ${outlineButtonClass}`}
            >
              Hide details
              <ChevronDown className="h-4 w-4 rotate-180" />
            </Button>
          </div>
        </>
      ) : null}

      {!open ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {props.canSelect ? (
            <label className={`inline-flex items-center gap-2 text-xs ${rowMuted}`}>
              <input
                type="checkbox"
                checked={props.isSelected}
                className={`h-4 w-4 rounded border bg-transparent ${
                  selected ? "border-white" : "border-gray-300 group-hover:border-white"
                }`}
                style={{
                  accentColor: "color-mix(in srgb, var(--brand-primary) 95%, transparent)",
                }}
                onChange={(e) => props.onToggleSelect(e.target.checked)}
              />
              Select
            </label>
          ) : null}

          <Button
            variant="outline"
            onClick={() => props.onToggleOpen(true)}
            className={`ml-auto ${outlineButtonClass}`}
          >
            Details
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
