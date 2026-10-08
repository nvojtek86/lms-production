
import {getUi} from "@/i18n/server";
import { Download, FileSpreadsheet, FileText, Calendar, Users, BookOpen, Award } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { notFound, redirect } from "next/navigation";
import { createAdminSupabaseClient, getServerUser } from "@/lib/supabase/server";
import { resolveOrgKey } from "@/lib/organizations/resolveOrgKey";
import { RecentExportsTableV2, type RecentExportItemV2 } from "@/components/table-v2/RecentExportsTableV2";
import { exportLabel, roleLabel } from "@/lib/audit/exportHelpers";

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

export default async function OrgExportPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams?: Promise<SearchParams> | SearchParams;
}) {
  const ui = await getUi();
  const sp = (await searchParams) ?? {};
  const { user, error } = await getServerUser();
  if (error || !user) redirect("/");

  const { orgId: orgKey } = await params;
  const resolved = await resolveOrgKey(orgKey);
  const org = resolved.org;
  if (!org) {
    if (user.role === "organization_admin" || user.role === "member") redirect("/unauthorized");
    notFound();
  }

  const orgId = org.id; // UUID (DB/API)
  const orgSlug = org.slug; // canonical slug (links)

  if (user.role === "member") redirect(`/org/${orgSlug}`);
  if (user.role === "organization_admin") {
    if (!user.organization_id || user.organization_id !== orgId) redirect("/unauthorized");
  }

  // Recent exports: read from audit_logs (we log export downloads there).
  const admin = createAdminSupabaseClient();
  const exportActions = ["export_users", "export_enrollments", "export_certificates", "export_courses", "export_organizations"];

  const exportsPageSize = 20;
  const exportsPageRaw = Number(spGet(sp, "exports_page") ?? "1");
  const exportsPageSafe = Number.isFinite(exportsPageRaw) && exportsPageRaw > 0 ? Math.floor(exportsPageRaw) : 1;

  const { count: exportsCountRaw, error: exportsCountError } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .in("action", exportActions)
    .eq("entity", "organizations")
    .eq("entity_id", orgId);

  const exportsTotalCount = typeof exportsCountRaw === "number" ? exportsCountRaw : 0;
  const exportsTotalPages = exportsTotalCount > 0 ? Math.max(1, Math.ceil(exportsTotalCount / exportsPageSize)) : 1;
  const exportsCurrent = exportsCountError ? exportsPageSafe : Math.min(Math.max(1, exportsPageSafe), exportsTotalPages);

  const exportsFromIdx = (Math.max(1, exportsCurrent) - 1) * exportsPageSize;
  const exportsToIdx = exportsFromIdx + exportsPageSize - 1;

  const { data: auditData, error: auditError } = await admin
    .from("audit_logs")
    .select("id, created_at, action, actor_email, actor_role, entity, entity_id, metadata")
    .in("action", exportActions)
    .eq("entity", "organizations")
    .eq("entity_id", orgId)
    .order("created_at", { ascending: false })
    .range(exportsFromIdx, exportsToIdx);

  const recentExports = (Array.isArray(auditData) ? auditData : []) as ExportAuditRow[];

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
            <p className="text-muted-foreground">{ui("Export your organization's data")}</p>
          </div>
        </div>
        <Button variant="outline" className="gap-2 shrink-0" disabled title={ui("Coming soon")}>
          <Calendar className="h-4 w-4" />
          {ui("Schedule Export")}</Button>
      </div>

      {/* Export Options Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border rounded-lg p-6 shadow-sm">
          <div className="flex flex-col items-center text-center">
            <div className="h-14 w-14 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
              <Users className="h-7 w-7 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">{ui("Users Export")}</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-4">{ui("Export all users in your organization")}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-2" asChild>
                <a href={`/api/exports/users?orgId=${encodeURIComponent(orgId)}`} target="_blank" rel="noreferrer">
                  <FileSpreadsheet className="h-4 w-4" />
                  {ui("CSV")}</a>
              </Button>
              <Button variant="outline" size="sm" className="gap-2" disabled title={ui("Coming soon")}>
                <FileSpreadsheet className="h-4 w-4" />
                {ui("Excel")}</Button>
            </div>
          </div>
        </div>

        <div className="bg-card border rounded-lg p-6 shadow-sm">
          <div className="flex flex-col items-center text-center">
            <div className="h-14 w-14 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
              <BookOpen className="h-7 w-7 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">{ui("Course Progress")}</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-4">{ui("Export enrollment results + assessment time")}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-2" asChild>
                <a href={`/api/reports/enrollments/export?orgId=${encodeURIComponent(orgId)}`} target="_blank" rel="noreferrer">
                  <FileSpreadsheet className="h-4 w-4" />
                  {ui("CSV")}</a>
              </Button>
              <Button variant="outline" size="sm" className="gap-2" disabled title={ui("Coming soon")}>
                <FileSpreadsheet className="h-4 w-4" />
                {ui("Excel")}</Button>
            </div>
          </div>
        </div>

        <div className="bg-card border rounded-lg p-6 shadow-sm">
          <div className="flex flex-col items-center text-center">
            <div className="h-14 w-14 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
              <Award className="h-7 w-7 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">{ui("Certificates Export")}</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-4">{ui("Export all issued certificates")}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-2" asChild>
                <a href={`/api/exports/certificates?orgId=${encodeURIComponent(orgId)}`} target="_blank" rel="noreferrer">
                  <FileSpreadsheet className="h-4 w-4" />
                  {ui("CSV")}</a>
              </Button>
              <Button variant="outline" size="sm" className="gap-2" disabled title={ui("Coming soon")}>
                <FileText className="h-4 w-4" />
                {ui("PDF")}</Button>
            </div>
          </div>
        </div>
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
        ) : recentExports.length === 0 ? (
          <div className="px-6 py-10 text-center text-muted-foreground">
            {ui("No export history yet. Your CSV exports will appear here after you download them above.")}</div>
        ) : (
          <div className="px-6 py-6">
            <RecentExportsTableV2
              items={recentExports.map((r): RecentExportItemV2 => {
                const who = r.actor_email ? `${r.actor_email}${r.actor_role ? ` (${roleLabel(r.actor_role)})` : ""}` : "—";
                const what = exportLabel(r.action ?? null);
                return {
                  id: r.id,
                  time: "—",
                  timeIso: r.created_at ?? null,
                  what,
                  who,
                  organization: null,
                  scope: r.entity ?? "organizations",
                  scopeId: r.entity_id ?? orgId,
                  meta: r.metadata ?? null,
                };
              })}
              emptyTitle={ui("No export history yet.")}
              emptySubtitle={ui("Your CSV exports will appear here after you download them above.")}
            />
          </div>
        )}

        {/* Pagination */}
        {!auditError && !exportsCountError && exportsTotalCount > 0 ? (
          <div className="px-6 py-4 border-t flex items-center justify-between gap-3 text-sm">
            <div className="text-muted-foreground">
              {ui("Showing ")}{exportsFromIdx + 1}–{Math.min(exportsFromIdx + recentExports.length, exportsTotalCount)} {ui("of ")}{exportsTotalCount}
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

