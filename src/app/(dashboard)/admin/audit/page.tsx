
import {getUi} from "@/i18n/server";
import { FileText, Download } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import LocalDateTime from "@/components/ui/LocalDateTime";
import { createAdminSupabaseClient, getServerUser } from "@/lib/supabase/server";

type AuditLogRow = {
  id: string;
  created_at?: string | null;
  action?: string | null;
  actor_email?: string | null;
  actor_role?: string | null;
  entity?: string | null;
  entity_id?: string | null;
  target_user_id?: string | null;
  metadata?: unknown;
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

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams> | SearchParams;
}) {
  const ui = await getUi();
  const { user, error } = await getServerUser();
  if (error || !user) return null;
  if (user.role !== "super_admin") return null;

  const sp = (await searchParams) ?? {};
  const page = Number(spGet(sp, "page") ?? "1");
  const pageSize = 20;
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;

  const admin = createAdminSupabaseClient();

  const { count: totalCountRaw } = await admin.from("audit_logs").select("id", { count: "exact", head: true });
  const total = typeof totalCountRaw === "number" ? totalCountRaw : 0;
  const totalPages = total > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const current = Math.min(Math.max(1, safePage), totalPages);

  const fromIdx = (current - 1) * pageSize;
  const toIdx = fromIdx + pageSize - 1;

  const { data, error: loadError } = await admin
    .from("audit_logs")
    .select("id, created_at, action, actor_email, actor_role, entity, entity_id, target_user_id, metadata")
    .order("created_at", { ascending: false })
    .range(fromIdx, toIdx);

  const rows = (Array.isArray(data) ? data : []) as AuditLogRow[];

  const pageHref = (p: number) => {
    const u = new URLSearchParams();
    u.set("page", String(p));
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
  for (const row of rows) {
    const meta = asRecord(row.metadata);

    // Users
    if (typeof row.target_user_id === "string" && row.target_user_id.length > 0) userIds.add(row.target_user_id);
    else if (row.entity === "users" && typeof row.entity_id === "string" && row.entity_id.length > 0) userIds.add(row.entity_id);

    // Orgs referenced in metadata
    const toOrgId = getMetaString(meta, "organization_id");
    const fromOrgId = getMetaString(meta, "previous_organization_id");
    if (toOrgId) orgIds.add(toOrgId);
    if (fromOrgId) orgIds.add(fromOrgId);

    // Orgs referenced by entity_id for org-related actions
    if (
      row.action === "disable_organization" ||
      row.action === "enable_organization" ||
      row.action === "create_organization" ||
      row.action === "upload_org_logo" ||
      row.action === "remove_org_logo"
    ) {
      if (typeof row.entity_id === "string" && row.entity_id.length > 0) orgIds.add(row.entity_id);
    }

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

    if (row.action === "disable_organization" || row.action === "enable_organization" || row.action === "create_organization") {
      const orgNameFromMeta = getMetaString(meta, "name");
      const orgId = (typeof row.entity_id === "string" && row.entity_id.length > 0) ? row.entity_id : getMetaString(meta, "organization_id");
      const label = orgNameFromMeta ?? orgLabel(orgId);
      return `organizations (${label})`;
    }

    if (row.action === "upload_org_logo" || row.action === "remove_org_logo") {
      const orgId = (typeof row.entity_id === "string" && row.entity_id.length > 0) ? row.entity_id : getMetaString(meta, "organization_id");
      return `storage.org-logos (${orgLabel(orgId)})`;
    }

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

    if (row.entity === "tests" && typeof row.entity_id === "string" && row.entity_id.length > 0) {
      return `tests (${row.entity_id})`;
    }
    if (row.action === "update_test_builder" && typeof row.entity_id === "string" && row.entity_id.length > 0) {
      return `tests (${row.entity_id})`;
    }

    if (row.entity === "courses" && typeof row.entity_id === "string" && row.entity_id.length > 0) {
      return `courses (${courseLabel(row.entity_id)})`;
    }
    if (row.action === "upload_course_cover" && typeof row.entity_id === "string" && row.entity_id.length > 0) {
      return `courses (${courseLabel(row.entity_id)})`;
    }


    return row.entity ? `${row.entity}${row.entity_id ? ` (${row.entity_id})` : ""}` : "-";
  };

  const getTargetDisplay = (row: AuditLogRow) => {
    if (row.target_user_id && typeof row.target_user_id === "string") {
      const v = userDisplayById.get(row.target_user_id);
      if (v) return `${v.label}${v.role ? ` (${roleLabel(v.role)})` : ""}`;
      return row.target_user_id;
    }
    return "-";
  };

  const getActionBadge = (action: string) => {
    const styles: Record<string, string> = {
      invite_user: "bg-green-100 text-green-700",
      upload_branding_logo: "bg-blue-100 text-blue-700",
      update_public_app_settings: "bg-amber-100 text-amber-700",
    };
    return styles[action] || 'bg-gray-100 text-gray-700';
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <FileText className="h-8 w-8 text-primary shrink-0" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">{ui("Audit Logs")}</h1>
            <p className="text-muted-foreground">{ui("Track all system activities and changes")}</p>
          </div>
        </div>
        <Button variant="outline" className="flex items-center gap-2 shrink-0" asChild>
          <a href="/api/audit/export?max=50000">
            <Download size={18} />
            {ui("Export Logs")}</a>
        </Button>
      </div>

      {loadError ? (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {ui("Failed to load audit logs: ")}{loadError.message}
        </div>
      ) : null}

      {/* Audit Logs Table */}
      <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
        <div className="w-full overflow-x-auto">
          <table className="min-w-max w-full">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Timestamp")}</th>
              <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Action")}</th>
              <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Details")}</th>
              <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("User")}</th>
              <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Target")}</th>
              <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Subject")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">
                  {ui("No audit logs yet.")}</td>
              </tr>
            ) : (
              rows.map((log) => (
                <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-6 py-4 text-sm text-muted-foreground font-mono">
                    <LocalDateTime iso={log.created_at} fallback="-" />
                  </td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${getActionBadge(log.action ?? "")}`}>
                    {log.action ?? "-"}
                  </span>
                </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    {getDetails(log)}
                  </td>
                  <td className="px-6 py-4 font-medium">
                    {log.actor_email ? `${log.actor_email}${log.actor_role ? ` (${log.actor_role})` : ""}` : "-"}
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    {getTargetDisplay(log)}
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    {getSubjectDisplay(log)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          </table>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {total > 0 ? (
          <span>
            {ui("Showing ")}{fromIdx + 1}–{Math.min(fromIdx + rows.length, total)} {ui("of ")}{total}
          </span>
        ) : (
          <span>{ui("Showing 0 results")}</span>
        )}
      </p>

      <div className="flex items-center justify-end gap-2">
        {(() => {
          const onlyOne = totalPages <= 1;
          const prevDisabled = onlyOne || current <= 1;
          const nextDisabled = onlyOne || current >= totalPages;
          const pager = buildPager(current, totalPages);

          return (
            <>
              {prevDisabled ? (
                <Button variant="outline" disabled>
                  {ui("Prev")}</Button>
              ) : (
                <Button asChild variant="outline">
                      <Link href={pageHref(current - 1)}>{ui("Prev")}</Link>
                </Button>
              )}

              <div className="flex items-center gap-1">
                {pager.map((p, idx) =>
                  p === "ellipsis" ? (
                    <span key={`e-${idx}`} className="px-2 text-muted-foreground select-none">
                      …
                    </span>
                  ) : p === current ? (
                    <Button key={p} disabled>
                      {p}
                    </Button>
                  ) : (
                    <Button key={p} asChild variant="outline">
                          <Link href={pageHref(p)}>{p}</Link>
                    </Button>
                  )
                )}
              </div>

              {nextDisabled ? (
                <Button variant="outline" disabled>
                  {ui("Next")}</Button>
              ) : (
                <Button asChild variant="outline">
                      <Link href={pageHref(current + 1)}>{ui("Next")}</Link>
                </Button>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}

