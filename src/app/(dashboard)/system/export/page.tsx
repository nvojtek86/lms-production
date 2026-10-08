
import {getUi} from "@/i18n/server";
import { Download, FileSpreadsheet, FileText, Calendar, Building2, Users, BookOpen, Award } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import { createAdminSupabaseClient, getServerUser } from "@/lib/supabase/server";
import { RecentExportsTableV2, type RecentExportItemV2 } from "@/components/table-v2/RecentExportsTableV2";
import { asRecord, exportLabel, getMetaString, roleLabel } from "@/lib/audit/exportHelpers";

export const fetchCache = "force-no-store";

type ExportAuditRow = {
  id: string;
  created_at?: string | null;
  action?: string | null;
  actor_email?: string | null;
  actor_role?: string | null;
  entity?: string | null;
  entity_id?: string | null;
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

export default async function SystemExportPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams> | SearchParams;
}) {
  const ui = await getUi();
  const sp = (await searchParams) ?? {};
  const { user, error } = await getServerUser();
  if (error || !user) redirect("/");
  if (!["super_admin", "system_admin"].includes(user.role)) redirect("/unauthorized");

  const isSystemAdmin = user.role === "system_admin";
  const admin = createAdminSupabaseClient();
  const exportActions = isSystemAdmin ? ["export_organizations"] : ["export_users", "export_enrollments", "export_certificates", "export_courses", "export_organizations"];

  const exportsPageSize = 20;
  const exportsPageRaw = Number(spGet(sp, "exports_page") ?? "1");
  const exportsPageSafe = Number.isFinite(exportsPageRaw) && exportsPageRaw > 0 ? Math.floor(exportsPageRaw) : 1;

  const { count: exportsCountRaw, error: exportsCountError } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .in("action", exportActions);

  const exportsTotalCount = typeof exportsCountRaw === "number" ? exportsCountRaw : 0;
  const exportsTotalPages = exportsTotalCount > 0 ? Math.max(1, Math.ceil(exportsTotalCount / exportsPageSize)) : 1;
  const exportsCurrent = exportsCountError ? exportsPageSafe : Math.min(Math.max(1, exportsPageSafe), exportsTotalPages);

  const exportsFromIdx = (Math.max(1, exportsCurrent) - 1) * exportsPageSize;
  const exportsToIdx = exportsFromIdx + exportsPageSize - 1;

  const { data: auditData, error: auditError } = await admin
    .from("audit_logs")
    .select("id, created_at, action, actor_email, actor_role, entity, entity_id, metadata")
    .in("action", exportActions)
    .order("created_at", { ascending: false })
    .range(exportsFromIdx, exportsToIdx);

  const rows = (Array.isArray(auditData) ? auditData : []) as ExportAuditRow[];

  // Hydrate organization labels referenced in export logs
  const orgIds = new Set<string>();
  for (const r of rows) {
    const meta = asRecord(r.metadata);
    const oid = getMetaString(meta, "organization_id");
    if (oid) orgIds.add(oid);
    if (r.entity === "organizations" && typeof r.entity_id === "string" && r.entity_id.length > 0) orgIds.add(r.entity_id);
  }

  const orgLabelById = new Map<string, string>();
  if (orgIds.size > 0) {
    const { data: orgData, error: orgErr } = await admin
      .from("organizations")
      .select("id, name, slug")
      .in("id", Array.from(orgIds));

    if (!orgErr && Array.isArray(orgData)) {
      for (const o of orgData as Array<{ id?: unknown; name?: unknown; slug?: unknown }>) {
        const id = typeof o.id === "string" ? o.id : null;
        if (!id) continue;
        const name = typeof o.name === "string" && o.name.trim().length ? o.name.trim() : null;
        const slug = typeof o.slug === "string" && o.slug.trim().length ? o.slug.trim() : null;
        orgLabelById.set(id, name ?? slug ?? id);
      }
    }
  }

  const exportsHref = (p: number) => {
    const u = new URLSearchParams();
    u.set("exports_page", String(p));
    return `?${u.toString()}`;
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Download className="h-8 w-8 text-primary shrink-0" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">{ui("Export Data")}</h1>
            <p className="text-muted-foreground">{isSystemAdmin ? ui("Export organization data") : ui("Export system data in various formats")}</p>
          </div>
        </div>
        <Button variant="outline" className="gap-2 shrink-0" disabled title={ui("Coming soon")}>
          <Calendar className="h-4 w-4" />
          {ui("Schedule Export")}</Button>
      </div>

      {/* Export Options Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {!isSystemAdmin ? (
          <div className="bg-card border rounded-lg p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Users className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-foreground">{ui("Users Export")}</h3>
                <p className="text-sm text-muted-foreground mt-1">{ui("Export all user data including roles and organizations")}</p>
                <div className="flex gap-2 mt-4">
                  <Button variant="outline" size="sm" className="gap-2" asChild>
                    <a href="/api/exports/users" target="_blank" rel="noreferrer">
                      <FileSpreadsheet className="h-4 w-4" />
                      {ui("CSV")}</a>
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" disabled title={ui("Coming soon")}>
                    <FileSpreadsheet className="h-4 w-4" />
                    {ui("Excel")}</Button>
                  <Button variant="outline" size="sm" className="gap-2" disabled title={ui("Coming soon")}>
                    <FileText className="h-4 w-4" />
                    {ui("JSON")}</Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="bg-card border rounded-lg p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-foreground">{ui("Organizations Export")}</h3>
              <p className="text-sm text-muted-foreground mt-1">{ui("Export organization details")}</p>
              <div className="flex gap-2 mt-4">
                <Button variant="outline" size="sm" className="gap-2" asChild>
                  <a href="/api/exports/organizations" target="_blank" rel="noreferrer">
                    <FileSpreadsheet className="h-4 w-4" />
                    {ui("CSV")}</a>
                </Button>
                <Button variant="outline" size="sm" className="gap-2" disabled title={ui("Coming soon")}>
                  <FileSpreadsheet className="h-4 w-4" />
                  {ui("Excel")}</Button>
                <Button variant="outline" size="sm" className="gap-2" disabled title={ui("Coming soon")}>
                  <FileText className="h-4 w-4" />
                  {ui("JSON")}</Button>
              </div>
            </div>
          </div>
        </div>

        {!isSystemAdmin ? (
        <div className="bg-card border rounded-lg p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <BookOpen className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-foreground">{ui("Courses Export")}</h3>
              <p className="text-sm text-muted-foreground mt-1">{ui("Export course data")}</p>
              <div className="flex gap-2 mt-4">
                <Button variant="outline" size="sm" className="gap-2" asChild>
                  <a href="/api/exports/courses" target="_blank" rel="noreferrer">
                    <FileSpreadsheet className="h-4 w-4" />
                    {ui("CSV")}</a>
                </Button>
                <Button variant="outline" size="sm" className="gap-2" disabled title={ui("Coming soon")}>
                  <FileSpreadsheet className="h-4 w-4" />
                  {ui("Excel")}</Button>
                <Button variant="outline" size="sm" className="gap-2" disabled title={ui("Coming soon")}>
                  <FileText className="h-4 w-4" />
                  {ui("JSON")}</Button>
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                {ui("Need enrollments + assessment-time export? Use the Reports export (Enrollments CSV).")}</div>
            </div>
          </div>
        </div>
        ) : null}

        {!isSystemAdmin ? (
          <div className="bg-card border rounded-lg p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Award className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-foreground">{ui("Certificates Export")}</h3>
                <p className="text-sm text-muted-foreground mt-1">{ui("Export all issued certificates")}</p>
                <div className="flex gap-2 mt-4">
                  <Button variant="outline" size="sm" className="gap-2" asChild>
                    <a href="/api/exports/certificates" target="_blank" rel="noreferrer">
                      <FileSpreadsheet className="h-4 w-4" />
                      {ui("CSV")}</a>
                  </Button>
                  <Button variant="outline" size="sm" className="gap-2" disabled title={ui("Coming soon")}>
                    <FileSpreadsheet className="h-4 w-4" />
                    {ui("Excel")}</Button>
                  <Button variant="outline" size="sm" className="gap-2" disabled title={ui("Coming soon")}>
                    <FileText className="h-4 w-4" />
                    {ui("PDF")}</Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Recent Exports */}
      <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
        <div className="p-6 border-b">
          <h2 className="text-lg font-semibold text-foreground">{ui("Recent Exports")}</h2>
          <p className="text-sm text-muted-foreground">{ui("Your recent export history")}</p>
        </div>

        {auditError ? (
          <div className="px-6 py-4 text-sm text-destructive">
            {ui("Failed to load export history: ")}{auditError.message}
          </div>
        ) : exportsCountError ? (
          <div className="px-6 py-4 text-sm text-amber-800 bg-amber-50 border-t border-amber-200">
            {ui("Export history count not available: ")}{exportsCountError.message}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-10 text-center text-muted-foreground">
            {ui("No export history yet. Exports are logged when you download a CSV above.")}</div>
        ) : (
          <div className="px-6 py-6">
            <RecentExportsTableV2
              items={rows.map((r): RecentExportItemV2 => {
                const meta = asRecord(r.metadata);
                const orgId =
                  (r.entity === "organizations" && typeof r.entity_id === "string" && r.entity_id.length > 0)
                    ? r.entity_id
                    : getMetaString(meta, "organization_id");
                const who = r.actor_email ? `${r.actor_email}${r.actor_role ? ` (${roleLabel(r.actor_role)})` : ""}` : "—";
                const what = exportLabel(r.action ?? null);
                const orgLabel = orgId ? (orgLabelById.get(orgId) ?? orgId) : null;

                return {
                  id: r.id,
                  time: "—",
                  timeIso: r.created_at ?? null,
                  what,
                  who,
                  organization: orgLabel,
                  scope: r.entity ?? null,
                  scopeId: r.entity_id ?? null,
                  meta: r.metadata ?? null,
                };
              })}
              emptyTitle={ui("No export history yet.")}
              emptySubtitle={ui("Exports are logged when you download a CSV above.")}
            />
          </div>
        )}

        {/* Pagination */}
        {!auditError && !exportsCountError && exportsTotalCount > 0 ? (
          <div className="px-6 py-4 border-t flex items-center justify-between gap-3 text-sm">
            <div className="text-muted-foreground">
              {ui("Showing ")}{exportsFromIdx + 1}–{Math.min(exportsFromIdx + rows.length, exportsTotalCount)} {ui("of ")}{exportsTotalCount}
            </div>
            <div className="flex items-center gap-2">
              {(() => {
                const onlyOne = exportsTotalPages <= 1;
                const prevDisabled = onlyOne || exportsCurrent <= 1;
                const nextDisabled = onlyOne || exportsCurrent >= exportsTotalPages;
                const pager = buildPager(exportsCurrent, exportsTotalPages);

                return (
                  <>
                    {prevDisabled ? (
                      <Button variant="outline" disabled>
                        {ui("Prev")}</Button>
                    ) : (
                      <Button asChild variant="outline">
                        <Link href={exportsHref(exportsCurrent - 1)}>{ui("Prev")}</Link>
                      </Button>
                    )}

                    <div className="flex items-center gap-1">
                      {pager.map((p, idx) =>
                        p === "ellipsis" ? (
                          <span key={`e-${idx}`} className="px-2 text-muted-foreground select-none">
                            …
                          </span>
                        ) : p === exportsCurrent ? (
                          <Button key={p} disabled>
                            {p}
                          </Button>
                        ) : (
                          <Button key={p} asChild variant="outline">
                            <Link href={exportsHref(p)}>{p}</Link>
                          </Button>
                        )
                      )}
                    </div>

                    {nextDisabled ? (
                      <Button variant="outline" disabled>
                        {ui("Next")}</Button>
                    ) : (
                      <Button asChild variant="outline">
                        <Link href={exportsHref(exportsCurrent + 1)}>{ui("Next")}</Link>
                      </Button>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

