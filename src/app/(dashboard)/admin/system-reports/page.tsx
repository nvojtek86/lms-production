
import {getUi} from "@/i18n/server";
import { BarChart3 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import LocalDateTime from "@/components/ui/LocalDateTime";
import { createAdminSupabaseClient, getServerUser } from "@/lib/supabase/server";

type AuditRow = {
  id: string;
  created_at?: string | null;
  action?: string | null;
  actor_email?: string | null;
  actor_role?: string | null;
  entity_id?: string | null;
  metadata?: unknown;
};

type UnauthApiRow = {
  id: string;
  created_at?: string | null;
  outcome?: "success" | "error" | null;
  status?: number | null;
  method?: string | null;
  path?: string | null;
  query?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  code?: string | null;
  public_message?: string | null;
  internal_message?: string | null;
  details?: unknown;
};

type SupportReportRow = {
  id: string;
  created_at?: string | null;
  support_id?: string | null;
  source?: string | null;
  step?: string | null;
  reporter_email?: string | null;
  reporter_role?: string | null;
  organization_id?: string | null;
  page_url?: string | null;
  user_agent?: string | null;
  is_resolved?: boolean | null;
  resolved_at?: string | null;
  payload?: unknown;
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

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function getString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function getNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export default async function SystemReportsPage({
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
  const filter = (spGet(sp, "filter") ?? "all").toLowerCase();
  const pageSize = 30;
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;

  const actions =
    filter === "errors"
      ? ["api_error"]
      : filter === "success"
        ? ["api_success"]
        : ["api_success", "api_error"];

  const admin = createAdminSupabaseClient();

  const { count: totalCountRaw } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .in("action", actions);

  const total = typeof totalCountRaw === "number" ? totalCountRaw : 0;
  const totalPages = total > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const current = Math.min(Math.max(1, safePage), totalPages);
  const fromIdx = (current - 1) * pageSize;
  const toIdx = fromIdx + pageSize - 1;

  const { data, error: loadError } = await admin
    .from("audit_logs")
    .select("id, created_at, action, actor_email, actor_role, entity_id, metadata")
    .in("action", actions)
    .order("created_at", { ascending: false })
    .range(fromIdx, toIdx);

  const rows = (Array.isArray(data) ? data : []) as AuditRow[];

  const { data: unauthData, error: unauthError } = await admin
    .from("unauth_api_events")
    .select(
      "id, created_at, outcome, status, method, path, query, ip, user_agent, code, public_message, internal_message, details"
    )
    .order("created_at", { ascending: false })
    .limit(30);

  const unauthRows = (Array.isArray(unauthData) ? unauthData : []) as UnauthApiRow[];

  const { data: supportData, error: supportError } = await admin
    .from("support_reports")
    .select(
      "id, created_at, support_id, source, step, reporter_email, reporter_role, organization_id, page_url, user_agent, is_resolved, resolved_at, payload"
    )
    .order("created_at", { ascending: false })
    .limit(50);

  const supportRows = (Array.isArray(supportData) ? supportData : []) as SupportReportRow[];

  const pageHref = (p: number) => {
    const u = new URLSearchParams();
    u.set("page", String(p));
    if (filter !== "all") u.set("filter", filter);
    return `?${u.toString()}`;
  };

  const filterHref = (f: "all" | "errors" | "success") => {
    const u = new URLSearchParams();
    u.set("page", "1");
    if (f !== "all") u.set("filter", f);
    return `?${u.toString()}`;
  };

  const getApiMeta = (row: AuditRow) => {
    const meta = asRecord(row.metadata);
    const api = asRecord(meta?.api);
    const method = getString(api?.method) ?? "—";
    const path = getString(api?.path) ?? (typeof row.entity_id === "string" ? row.entity_id : "—");
    const status = getNumber(api?.status);
    const code = getString(api?.code);
    const publicMessage = getString(api?.public_message) ?? "—";
    const internalMessage = getString(api?.internal_message);
    return { method, path, status, code, publicMessage, internalMessage, rawMeta: meta };
  };

  const badgeClass = (action: string | null) => {
    if (action === "api_error") return "bg-destructive/10 text-destructive";
    if (action === "api_success") return "bg-green-100 text-green-700";
    return "bg-muted text-muted-foreground";
  };

  const unauthBadgeClass = (outcome: string | null | undefined) => {
    if (outcome === "error") return "bg-destructive/10 text-destructive";
    if (outcome === "success") return "bg-green-100 text-green-700";
    return "bg-muted text-muted-foreground";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-8 w-8 text-primary shrink-0" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">{ui("System Reports")}</h1>
            <p className="text-muted-foreground">
              {ui("Centralized API success/error messages (super_admin only).")}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant={filter === "all" ? "default" : "outline"} className="shrink-0">
            <Link href={filterHref("all")}>{ui("All")}</Link>
          </Button>
          <Button asChild variant={filter === "errors" ? "default" : "outline"} className="shrink-0">
            <Link href={filterHref("errors")}>{ui("Errors")}</Link>
          </Button>
          <Button asChild variant={filter === "success" ? "default" : "outline"} className="shrink-0">
            <Link href={filterHref("success")}>{ui("Success")}</Link>
          </Button>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {ui("Failed to load system reports: ")}{loadError.message}
        </div>
      ) : null}

      <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
        <div className="w-full overflow-x-auto">
          <table className="min-w-max w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Timestamp")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Result")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("API")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Message")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("User")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Details")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">
                    {ui("No system report entries yet.")}</td>
                </tr>
              ) : (
                rows.map((r) => {
                  const api = getApiMeta(r);
                  return (
                    <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-6 py-4 text-sm text-muted-foreground font-mono">
                        <LocalDateTime iso={r.created_at} />
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${badgeClass(r.action ?? null)}`}>
                          {r.action === "api_error" ? ui("Error") : r.action === "api_success" ? ui("Success") : (r.action ?? "—")}
                        </span>
                        {typeof api.status === "number" ? (
                          <div className="mt-1 text-xs text-muted-foreground">{ui("HTTP ")}{api.status}{api.code ? ` • ${api.code}` : ""}</div>
                        ) : null}
                      </td>
                      <td className="px-6 py-4 text-sm text-foreground">
                        <div className="font-mono text-xs text-muted-foreground">{api.method}</div>
                        <div className="font-mono text-sm">{api.path}</div>
                      </td>
                      <td className="px-6 py-4 text-sm text-foreground">
                        <div>{api.publicMessage}</div>
                        {api.internalMessage ? (
                          <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
                            {ui("Internal: ")}{api.internalMessage}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {r.actor_email ? `${r.actor_email}${r.actor_role ? ` (${r.actor_role})` : ""}` : "—"}
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        <details>
                          <summary className="cursor-pointer select-none">{ui("View")}</summary>
                          <pre className="mt-2 max-w-[680px] overflow-auto rounded-md border bg-muted/20 p-3 text-xs">
{JSON.stringify(api.rawMeta, null, 2)}
                          </pre>
                        </details>
                      </td>
                    </tr>
                  );
                })
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

      <div className="pt-2">
        <h2 className="text-xl font-semibold text-foreground">{ui("Support reports")}</h2>
        <p className="text-sm text-muted-foreground">
          {ui("User-submitted error reports from the app (stored in ")}<span className="font-mono">{ui("support_reports")}</span>).
        </p>
      </div>

      {supportError ? (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {ui("Failed to load support reports: ")}{supportError.message}
          <div className="mt-1 text-xs text-muted-foreground">
            {ui("Make sure the ")}<span className="font-mono">{ui("support_reports")}</span> {ui("SQL was applied in this environment.")}</div>
        </div>
      ) : null}

      <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
        <div className="w-full overflow-x-auto">
          <table className="min-w-max w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Timestamp")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Support ID")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Step")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Reporter")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Status")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Details")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {supportRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">
                    {ui("No support reports yet.")}</td>
                </tr>
              ) : (
                supportRows.map((r) => {
                  const resolved = Boolean(r.is_resolved);
                  return (
                    <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-6 py-4 text-sm text-muted-foreground font-mono">
                        <LocalDateTime iso={r.created_at} />
                      </td>
                      <td className="px-6 py-4 text-sm text-foreground font-mono">{r.support_id ?? "—"}</td>
                      <td className="px-6 py-4 text-sm text-foreground">
                        <div className="text-xs text-muted-foreground">{r.source ?? "—"}</div>
                        <div className="mt-1">{r.step ?? "—"}</div>
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {r.reporter_email ? `${r.reporter_email}${r.reporter_role ? ` (${r.reporter_role})` : ""}` : "—"}
                        {r.organization_id ? (
                          <div className="mt-1 font-mono text-xs text-muted-foreground">{ui("org: ")}{r.organization_id}</div>
                        ) : null}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded-full ${
                            resolved ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {resolved ? ui("Resolved") : ui("Open")}
                        </span>
                        {resolved && r.resolved_at ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {ui("at ")}<LocalDateTime iso={r.resolved_at} />
                          </div>
                        ) : null}
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        <details>
                          <summary className="cursor-pointer select-none">{ui("View")}</summary>
                          <pre className="mt-2 max-w-[680px] overflow-auto rounded-md border bg-muted/20 p-3 text-xs">
{JSON.stringify(
  {
    page_url: r.page_url ?? null,
    user_agent: r.user_agent ?? null,
    payload: r.payload ?? null,
  },
  null,
  2
)}
                          </pre>
                        </details>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="pt-2">
        <h2 className="text-xl font-semibold text-foreground">{ui("Unauthenticated API events")}</h2>
        <p className="text-sm text-muted-foreground">
          {ui("These are API success/error messages where no authenticated caller could be attributed (logged to")}{" "}
          <span className="font-mono">{ui("unauth_api_events")}</span>).
        </p>
      </div>

      {unauthError ? (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {ui("Failed to load unauthenticated events: ")}{unauthError.message}
          <div className="mt-1 text-xs text-muted-foreground">
            {ui("If this is a new environment, make sure the migration creating ")}<span className="font-mono">{ui("unauth_api_events")}</span> {ui("was applied.")}</div>
        </div>
      ) : null}

      <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
        <div className="w-full overflow-x-auto">
          <table className="min-w-max w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Timestamp")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Result")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("API")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Message")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Client")}</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-muted-foreground">{ui("Details")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {unauthRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">
                    {ui("No unauthenticated API events yet.")}</td>
                </tr>
              ) : (
                unauthRows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4 text-sm text-muted-foreground font-mono">
                      <LocalDateTime iso={r.created_at} />
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${unauthBadgeClass(r.outcome)}`}>
                        {r.outcome === "error" ? ui("Error") : r.outcome === "success" ? ui("Success") : "—"}
                      </span>
                      {typeof r.status === "number" ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {ui("HTTP ")}{r.status}{r.code ? ` • ${r.code}` : ""}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-6 py-4 text-sm text-foreground">
                      <div className="font-mono text-xs text-muted-foreground">{r.method ?? "—"}</div>
                      <div className="font-mono text-sm">{r.path ?? "—"}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-foreground">
                      <div>{r.public_message ?? "—"}</div>
                      {r.internal_message ? (
                        <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
                          {ui("Internal: ")}{r.internal_message}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      <div className="font-mono text-xs">{r.ip ?? "—"}</div>
                      <div className="mt-1 text-xs line-clamp-2">{r.user_agent ?? "—"}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      <details>
                        <summary className="cursor-pointer select-none">{ui("View")}</summary>
                        <pre className="mt-2 max-w-[680px] overflow-auto rounded-md border bg-muted/20 p-3 text-xs">
{JSON.stringify(
  {
    query: r.query ?? "",
    details: r.details ?? null,
  },
  null,
  2
)}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

