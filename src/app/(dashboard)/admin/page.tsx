
import {getUi} from "@/i18n/server";
import { LayoutDashboard, Building2, Users, BookOpen, Award, FileText } from "lucide-react";
import Link from "next/link";
import { createAdminSupabaseClient, getServerUser } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { RecentActivityTableV2, type RecentActivityItemV2 } from "@/components/table-v2/RecentActivityTableV2";

type Stat = { label: string; value: string; icon: typeof Building2; color: string; error?: string | null };

async function safeCount(admin: ReturnType<typeof createAdminSupabaseClient>, table: string, filter?: { column: string; value: unknown }) {
  try {
    let q = admin.from(table).select("*", { count: "exact", head: true });
    if (filter) q = q.eq(filter.column, filter.value);
    const { count, error } = await q;
    return { count: typeof count === "number" ? count : 0, error: error?.message ?? null };
  } catch (e) {
    return { count: 0, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

type AuditLogRow = {
  id: string;
  created_at?: string | null;
  action?: string | null;
  actor_email?: string | null;
  actor_role?: string | null;
  entity?: string | null;
  entity_id?: string | null;
  target_user_id?: string | null;
  metadata?: unknown | null;
};

type SearchParams = Record<string, string | string[] | undefined>;
function spGet(sp: SearchParams, key: string): string | null {
  const v = sp[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : null;
  return null;
}

function buildPager(current: number, total: number): Array<number | "ellipsis"> {
  const t = Math.max(1, Math.floor(total));
  const c = Math.min(Math.max(1, Math.floor(current)), t);
  if (t <= 7) return Array.from({ length: t }, (_, i) => i + 1);

  const pages = new Set<number>([1, t, c, c - 1, c + 1]);
  const list = Array.from(pages).filter((p) => p >= 1 && p <= t).sort((a, b) => a - b);
  const out: Array<number | "ellipsis"> = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const prev = list[i - 1];
    if (typeof prev === "number" && p - prev > 1) out.push("ellipsis");
    out.push(p);
  }
  return out;
}

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams> | SearchParams;
}) {
  return <AdminDashboardContent searchParams={searchParams} />;
}

async function AdminDashboardContent(props: { searchParams?: Promise<SearchParams> | SearchParams }) {
  const ui = await getUi();
  const { user, error } = await getServerUser();
  if (error || !user) {
    return null;
  }
  if (user.role !== "super_admin") {
    return null;
  }

  const admin = createAdminSupabaseClient();
  const sp = (await props.searchParams) ?? {};
  const activityPage = Number(spGet(sp, "activity_page") ?? "1");
  const activityPageSize = 10;
  const safeActivityPage = Number.isFinite(activityPage) && activityPage > 0 ? Math.floor(activityPage) : 1;

  const [
    orgsTotal,
    orgsInactive,
    usersTotal,
    usersActive,
    courses,
    certificates,
  ] = await Promise.all([
    safeCount(admin, "organizations"),
    safeCount(admin, "organizations", { column: "is_active", value: false }),
    safeCount(admin, "users"),
    safeCount(admin, "users", { column: "is_active", value: true }),
    safeCount(admin, "courses"),
    safeCount(admin, "certificates"),
  ]);

  // Treat NULL as active (legacy), so active = total - inactive (inactive is explicit false)
  const activeOrgsCount = Math.max(0, orgsTotal.count - orgsInactive.count);
  const orgsCountError = orgsTotal.error || orgsInactive.error;

  const stats: Stat[] = [
    {
      label: ui("Organizations (Active / Inactive)"),
      value: `${activeOrgsCount} / ${orgsInactive.count}`,
      icon: Building2,
      color: "bg-blue-500",
      error: orgsCountError,
    },
    { label: ui("Total Users"), value: String(usersTotal.count), icon: Users, color: "bg-green-500", error: usersTotal.error },
    { label: ui("Active Users"), value: String(usersActive.count), icon: Users, color: "bg-emerald-500", error: usersActive.error },
    { label: ui("Courses"), value: String(courses.count), icon: BookOpen, color: "bg-purple-500", error: courses.error },
    { label: ui("Certificates"), value: String(certificates.count), icon: Award, color: "bg-amber-500", error: certificates.error },
  ];

  const { count: activityCountRaw, error: activityCountError } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true });

  const activityTotalCount = typeof activityCountRaw === "number" ? activityCountRaw : 0;
  const activityTotalPages = activityTotalCount > 0 ? Math.max(1, Math.ceil(activityTotalCount / activityPageSize)) : 1;
  const activityCurrent = activityCountError ? safeActivityPage : Math.min(Math.max(1, safeActivityPage), activityTotalPages);

  const activityFromIdx = (Math.max(1, activityCurrent) - 1) * activityPageSize;
  const activityToIdx = activityFromIdx + activityPageSize - 1;

  const { data: recentAudit, error: auditError } = await admin
    .from("audit_logs")
    .select("id, created_at, action, actor_email, actor_role, entity, entity_id, target_user_id, metadata")
    .order("created_at", { ascending: false })
    .range(activityFromIdx, activityToIdx);

  const auditRows = (Array.isArray(recentAudit) ? recentAudit : []) as AuditLogRow[];
  const auditLoadError = auditError?.message ?? null;

  const activityHref = (p: number) => {
    const u = new URLSearchParams();
    u.set("activity_page", String(p));
    return `?${u.toString()}`;
  };

  const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

  const getMetaString = (m: Record<string, unknown> | null, key: string): string | null => {
    const val = m?.[key];
    return typeof val === "string" && val.trim().length > 0 ? val.trim() : null;
  };

  const orgIds = new Set<string>();
  const userIds = new Set<string>();
  const courseIds = new Set<string>();

  for (const row of auditRows) {
    const meta = asRecord(row.metadata);

    // Users (subjects)
    if (typeof row.target_user_id === "string" && row.target_user_id.length > 0) {
      userIds.add(row.target_user_id);
    } else if (row.entity === "users" && typeof row.entity_id === "string" && row.entity_id.length > 0) {
      userIds.add(row.entity_id);
    }

    // Organizations (exports and generic org subjects)
    if (row.entity === "organizations" && typeof row.entity_id === "string" && row.entity_id.length > 0) {
      orgIds.add(row.entity_id);
    }
    if ((row.action ?? "").startsWith("export_")) {
      const oid = getMetaString(meta, "organization_id");
      if (oid) orgIds.add(oid);
    }

    // Organizations (subjects / details)
    if (row.action === "assign_user_organization") {
      const toOrgId = getMetaString(meta, "organization_id");
      const fromOrgId = getMetaString(meta, "previous_organization_id");
      if (toOrgId) orgIds.add(toOrgId);
      if (fromOrgId) orgIds.add(fromOrgId);
    }

    if (
      row.action === "disable_organization" ||
      row.action === "enable_organization" ||
      row.action === "create_organization" ||
      row.action === "upload_org_logo" ||
      row.action === "remove_org_logo"
    ) {
      const oid = (typeof row.entity_id === "string" && row.entity_id.length > 0) ? row.entity_id : getMetaString(meta, "organization_id");
      if (oid) orgIds.add(oid);
    }

    if (row.action === "invite_user") {
      const invitedOrgId = getMetaString(meta, "organization_id");
      if (invitedOrgId) orgIds.add(invitedOrgId);
    }

    // Courses (subjects / details)
    if (row.entity === "courses" && typeof row.entity_id === "string" && row.entity_id.length > 0) {
      courseIds.add(row.entity_id);
    }
    if (row.action === "upload_course_cover" && typeof row.entity_id === "string" && row.entity_id.length > 0) {
      courseIds.add(row.entity_id);
    }
    if (
      (row.action === "upload_certificate_template" ||
        row.action === "upload_course_resource" ||
        row.action === "create_course_test") &&
      typeof row.entity_id === "string" &&
      row.entity_id.length > 0
    ) {
      courseIds.add(row.entity_id);
    }
  }

  const orgLabelById = new Map<string, string>();
  if (orgIds.size > 0) {
    const { data: orgData, error: orgError } = await admin
      .from("organizations")
      .select("id, name, slug")
      .in("id", Array.from(orgIds));

    if (!orgError && Array.isArray(orgData)) {
      for (const o of orgData as Array<{ id?: unknown; name?: unknown; slug?: unknown }>) {
        const id = typeof o.id === "string" ? o.id : null;
        if (!id) continue;
        const name = typeof o.name === "string" && o.name.trim().length ? o.name.trim() : null;
        const slug = typeof o.slug === "string" && o.slug.trim().length ? o.slug.trim() : null;
        orgLabelById.set(id, name ?? slug ?? id);
      }
    }
  }

  const orgLabel = (orgId: string | null) => {
    if (!orgId) return "No organization";
    return orgLabelById.get(orgId) ?? orgId;
  };

  const roleLabel = (role: string | null) => {
    switch (role) {
      case "super_admin":
        return "Super Admin";
      case "system_admin":
        return "System Admin";
      case "organization_admin":
        return "Organization Admin";
      case "member":
        return "Member";
      default:
        return role ?? "";
    }
  };

  const userDisplayById = new Map<string, { label: string; role: string | null }>();
  if (userIds.size > 0) {
    const { data: usersData, error: usersError } = await admin
      .from("users")
      .select("id, full_name, email, role")
      .in("id", Array.from(userIds));

    if (!usersError && Array.isArray(usersData)) {
      for (const u of usersData as Array<{ id?: unknown; full_name?: unknown; email?: unknown; role?: unknown }>) {
        const id = typeof u.id === "string" ? u.id : null;
        if (!id) continue;
        const fullName = typeof u.full_name === "string" && u.full_name.trim().length ? u.full_name.trim() : null;
        const email = typeof u.email === "string" && u.email.trim().length ? u.email.trim() : null;
        const role = typeof u.role === "string" ? u.role : null;
        userDisplayById.set(id, { label: fullName ?? email ?? id, role });
      }
    }
  }

  const courseLabelById = new Map<string, string>();
  if (courseIds.size > 0) {
    const { data: coursesData, error: coursesError } = await admin
      .from("courses")
      .select("id, title")
      .in("id", Array.from(courseIds));

    if (!coursesError && Array.isArray(coursesData)) {
      for (const c of coursesData as Array<{ id?: unknown; title?: unknown }>) {
        const id = typeof c.id === "string" ? c.id : null;
        if (!id) continue;
        const title = typeof c.title === "string" && c.title.trim().length ? c.title.trim() : null;
        courseLabelById.set(id, title ?? "Untitled course");
      }
    }
  }

  const courseLabel = (courseId: string | null) => {
    if (!courseId) return "Unknown course";
    return courseLabelById.get(courseId) ?? "Unknown course";
  };

  const getDetails = (row: AuditLogRow) => {
    const meta = asRecord(row.metadata);

    const getMetaNumber = (m: Record<string, unknown> | null, key: string): number | null => {
      const v = m?.[key];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      const n = typeof v === "string" ? Number(v) : NaN;
      return Number.isFinite(n) ? n : null;
    };

    if (row.action === "assign_user_organization") {
      const toOrgId = getMetaString(meta, "organization_id");
      const toOrgName = getMetaString(meta, "organization_name");
      const fromOrgId = getMetaString(meta, "previous_organization_id");
      const fromText = orgLabel(fromOrgId);
      const toText = toOrgName ?? orgLabel(toOrgId);
      return `Moved org: ${fromText} → ${toText}`;
    }

    const actorDisplay = row.actor_email
      ? `${row.actor_email}${row.actor_role ? ` (${roleLabel(row.actor_role)})` : ""}`
      : "Someone";

    // Exports
    const action = row.action ?? "";
    if (action.startsWith("export_")) {
      const exportKey = action.slice("export_".length);
      const exportName =
        exportKey === "users"
          ? "Users"
          : exportKey === "enrollments"
            ? "Enrollments"
            : exportKey === "certificates"
              ? "Certificates"
              : exportKey === "courses"
                ? "Courses"
                : exportKey === "organizations"
                  ? "Organizations"
                  : exportKey;

      const fmt = (getMetaString(meta, "format") ?? "csv").toUpperCase();
      const rowCount = getMetaNumber(meta, "row_count");
      const oid =
        (row.entity === "organizations" && typeof row.entity_id === "string" && row.entity_id.length > 0)
          ? row.entity_id
          : getMetaString(meta, "organization_id");
      const orgText = oid ? orgLabel(oid) : "all organizations";
      const rowsText = typeof rowCount === "number" ? ` • ${rowCount} rows` : "";
      return `${actorDisplay} exported ${exportName} (${fmt})${rowsText} for ${orgText}.`;
    }

    if (row.action === "enable_organization" || row.action === "disable_organization") {
      const orgId =
        (typeof row.entity_id === "string" && row.entity_id.length > 0)
          ? row.entity_id
          : getMetaString(meta, "organization_id");
      const name = orgLabel(orgId);
      return row.action === "enable_organization" ? `${name} is Active` : `${name} is Inactive`;
    }

    if (row.action === "create_organization") {
      const orgNameFromMeta = getMetaString(meta, "name");
      const orgId = (typeof row.entity_id === "string" && row.entity_id.length > 0) ? row.entity_id : null;
      const name = orgNameFromMeta ?? orgLabel(orgId);
      return `Organization created: ${name}.`;
    }

    if (row.action === "enable_user" || row.action === "disable_user") {
      const uid =
        (typeof row.target_user_id === "string" && row.target_user_id.length > 0)
          ? row.target_user_id
          : (row.entity === "users" && typeof row.entity_id === "string" ? row.entity_id : null);
      const resolved = uid ? userDisplayById.get(uid) : null;
      const label = resolved?.label ?? uid ?? "Unknown user";
      return row.action === "enable_user" ? `${label} is Active` : `${label} is Disabled`;
    }

    if (row.action === "upload_org_logo") {
      return `${actorDisplay} has uploaded new logo.`;
    }

    if (row.action === "upload_branding_logo") {
      return `${actorDisplay} has uploaded new logo.`;
    }

    if (row.action === "upload_user_avatar") {
      return `${actorDisplay} has updated their avatar.`;
    }

    if (row.action === "remove_user_avatar") {
      return `${actorDisplay} has removed their avatar.`;
    }

    if (row.action === "set_user_avatar_preset") {
      const preset = getMetaString(meta, "preset_name");
      return `${actorDisplay} has selected a preset avatar${preset ? ` (${preset})` : ""}.`;
    }

    if (row.action === "update_public_app_settings") {
      return `${actorDisplay} has updated General Settings.`;
    }

    if (row.action === "invite_user") {
      const invited = getMetaString(meta, "invited_email") ?? "a user";
      return `${actorDisplay} has invited ${invited}.`;
    }

    if (row.action === "send_password_setup_link") {
      const uid =
        (typeof row.target_user_id === "string" && row.target_user_id.length > 0)
          ? row.target_user_id
          : (row.entity === "users" && typeof row.entity_id === "string" ? row.entity_id : null);
      const resolved = uid ? userDisplayById.get(uid) : null;
      const label = resolved?.label ?? uid ?? "a user";
      return `${actorDisplay} sent a password setup link to ${label}.`;
    }

    if (row.action === "upload_course_cover") {
      const courseId = typeof row.entity_id === "string" && row.entity_id.length > 0 ? row.entity_id : null;
      return `${actorDisplay} added ${courseLabel(courseId)} cover image.`;
    }

    if (row.action === "upload_certificate_template") {
      const courseId = typeof row.entity_id === "string" && row.entity_id.length > 0 ? row.entity_id : null;
      const fileName = getMetaString(meta, "file_name");
      return `${actorDisplay} uploaded certificate template${fileName ? ` (${fileName})` : ""} for ${courseLabel(courseId)}.`;
    }

    if (row.action === "upload_course_resource") {
      const courseId = typeof row.entity_id === "string" && row.entity_id.length > 0 ? row.entity_id : null;
      const fileName = getMetaString(meta, "file_name");
      return `${actorDisplay} uploaded course resource${fileName ? ` (${fileName})` : ""} to ${courseLabel(courseId)}.`;
    }

    if (row.action === "create_course_test") {
      const courseId = typeof row.entity_id === "string" && row.entity_id.length > 0 ? row.entity_id : null;
      const tid = getMetaString(meta, "test_id");
      return `${actorDisplay} created a legacy assessment${tid ? ` (${tid})` : ""} for ${courseLabel(courseId)}.`;
    }

    if (row.action === "update_test_builder") {
      const testId = typeof row.entity_id === "string" && row.entity_id.length > 0 ? row.entity_id : null;
      const count = getMetaNumber(meta, "questions");
      const countText = typeof count === "number" ? ` (${count} questions)` : "";
      return `${actorDisplay} updated a legacy assessment${countText}${testId ? ` (${testId})` : ""}.`;
    }

    return "—";
  };

  const getSubjectDisplay = (row: AuditLogRow) => {
    const meta = asRecord(row.metadata);

    // User-focused actions (show who was affected)
    if (
      row.action === "assign_user_organization" ||
      row.action === "disable_user" ||
      row.action === "enable_user" ||
      row.action === "invite_user" ||
      row.action === "send_password_setup_link" ||
      row.action === "upload_user_avatar" ||
      row.action === "remove_user_avatar" ||
      row.action === "set_user_avatar_preset"
    ) {
      const uid =
        (typeof row.target_user_id === "string" && row.target_user_id.length > 0)
          ? row.target_user_id
          : (row.entity === "users" && typeof row.entity_id === "string" ? row.entity_id : null);

      const fromMetaName = getMetaString(meta, "full_name");
      const fromMetaEmail = getMetaString(meta, "invited_email");
      const roleFromMeta = getMetaString(meta, "invited_role");
      const resolved = uid ? userDisplayById.get(uid) : null;
      const label = resolved?.label ?? fromMetaName ?? fromMetaEmail ?? uid ?? "Unknown user";
      const role = resolved?.role ?? roleFromMeta ?? null;
      return `users (${label}${role ? ` / ${roleLabel(role)}` : ""})`;
    }

    // Organization enable/disable/create
    if (row.action === "disable_organization" || row.action === "enable_organization" || row.action === "create_organization") {
      const orgNameFromMeta = getMetaString(meta, "name");
      const orgId = (typeof row.entity_id === "string" && row.entity_id.length > 0) ? row.entity_id : getMetaString(meta, "organization_id");
      const label = orgNameFromMeta ?? orgLabel(orgId);
      return `organizations (${label})`;
    }

    // Org logo actions
    if (row.action === "upload_org_logo" || row.action === "remove_org_logo") {
      const orgId = (typeof row.entity_id === "string" && row.entity_id.length > 0) ? row.entity_id : getMetaString(meta, "organization_id");
      return `storage.org-logos (${orgLabel(orgId)})`;
    }

    // Global branding logo
    if (row.action === "upload_branding_logo") {
      return "storage.branding (global)";
    }

    // Exports
    const action = row.action ?? "";
    if (action.startsWith("export_")) {
      const oid =
        (row.entity === "organizations" && typeof row.entity_id === "string" && row.entity_id.length > 0)
          ? row.entity_id
          : getMetaString(meta, "organization_id");
      if (oid) return `organizations (${orgLabel(oid)})`;
      return "system (all organizations)";
    }

    // Organizations (generic)
    if (row.entity === "organizations" && typeof row.entity_id === "string" && row.entity_id.length > 0) {
      return `organizations (${orgLabel(row.entity_id)})`;
    }

    // Legacy tests (feature removed)
    if (row.entity === "tests" && typeof row.entity_id === "string" && row.entity_id.length > 0) {
      return `tests (${row.entity_id})`;
    }
    if (row.action === "update_test_builder" && typeof row.entity_id === "string" && row.entity_id.length > 0) {
      return `tests (${row.entity_id})`;
    }

    // Courses
    if (row.entity === "courses" && typeof row.entity_id === "string" && row.entity_id.length > 0) {
      return `courses (${courseLabel(row.entity_id)})`;
    }
    if (row.action === "upload_course_cover" && typeof row.entity_id === "string" && row.entity_id.length > 0) {
      return `courses (${courseLabel(row.entity_id)})`;
    }

    // Fallback
    return row.entity ? `${row.entity}${row.entity_id ? ` (${row.entity_id})` : ""}` : "-";
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <LayoutDashboard className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">{ui("Super Admin Dashboard")}</h1>
          <p className="text-muted-foreground">
            {user.full_name && user.full_name.trim().length > 0
              ? ui("Welcome back, Super Admin {v0}", {v0: user.full_name.trim()})
              : ui("Welcome back, Super Admin")}
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 min-[1024px]:grid-cols-3 min-[1440px]:grid-cols-5 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="bg-card border rounded-lg p-6 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-3xl font-bold text-foreground mt-1">{stat.value}</p>
                  {stat.error ? (
                    <p className="mt-1 text-xs text-destructive">
                      {stat.error.includes("relation") ? ui("Missing table / schema") : stat.error}
                    </p>
                  ) : null}
                </div>
                <div className={`${stat.color} p-3 rounded-lg`}>
                  <Icon className="h-6 w-6 text-white" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent Activity */}
      <div className="bg-card border rounded-lg p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <FileText className="h-5 w-5" />
          {ui("Recent Activity")}</h2>

        {auditLoadError ? (
          <div className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {ui("Failed to load audit logs: ")}{auditLoadError}
          </div>
        ) : auditRows.length === 0 ? (
          <div className="text-muted-foreground text-center py-8">
            <p>{ui("No recent activity yet.")}</p>
            <p className="text-sm mt-2">{ui("Once you start inviting users and changing settings, logs will show here.")}</p>
          </div>
        ) : (
          <>
            <RecentActivityTableV2
              items={auditRows.map((row): RecentActivityItemV2 => {
                const actor =
                  row.actor_email ? `${row.actor_email}${row.actor_role ? ` (${roleLabel(row.actor_role)})` : ""}` : "-";
                const subject = getSubjectDisplay(row);
                const title = row.action ?? "—";
                const details = getDetails(row);
                return {
                  id: row.id,
                  time: "—",
                  timeIso: row.created_at ?? null,
                  actor,
                  subject,
                  title,
                  details,
                  meta: row.metadata ?? null,
                };
              })}
              emptyTitle={ui("No recent activity yet.")}
              emptySubtitle={ui("Once you start inviting users and changing settings, logs will show here.")}
            />

            <div className="mt-4 flex items-center justify-between gap-3 text-sm">
              <div className="text-muted-foreground">
                {activityTotalCount > 0 ? (
                  <span>
                    {ui("Showing ")}{activityFromIdx + 1}–{Math.min(activityFromIdx + auditRows.length, activityTotalCount)} {ui("of ")}{activityTotalCount}
                  </span>
                ) : (
                  <span>{ui("Showing 0 results")}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {(() => {
                  const onlyOne = activityTotalPages <= 1;
                  const prevDisabled = onlyOne || activityCurrent <= 1;
                  const nextDisabled = onlyOne || activityCurrent >= activityTotalPages;
                  const pager = buildPager(activityCurrent, activityTotalPages);

                  return (
                    <>
                      {prevDisabled ? (
                        <Button variant="outline" disabled>
                          {ui("Prev")}</Button>
                      ) : (
                        <Button asChild variant="outline">
                          <Link href={activityHref(activityCurrent - 1)}>{ui("Prev")}</Link>
                        </Button>
                      )}

                      <div className="flex items-center gap-1">
                        {pager.map((p, idx) =>
                          p === "ellipsis" ? (
                            <span key={`e-${idx}`} className="px-2 text-muted-foreground select-none">
                              …
                            </span>
                          ) : p === activityCurrent ? (
                            <Button key={p} disabled>
                              {p}
                            </Button>
                          ) : (
                            <Button key={p} asChild variant="outline">
                              <Link href={activityHref(p)}>{p}</Link>
                            </Button>
                          )
                        )}
                      </div>

                      {nextDisabled ? (
                        <Button variant="outline" disabled>
                          {ui("Next")}</Button>
                      ) : (
                        <Button asChild variant="outline">
                          <Link href={activityHref(activityCurrent + 1)}>{ui("Next")}</Link>
                        </Button>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

