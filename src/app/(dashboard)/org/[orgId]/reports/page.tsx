
import {getUi} from "@/i18n/server";
import { notFound, redirect } from "next/navigation";
import { BarChart3, Download, Users, BookOpen, Award, TrendingUp } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { createAdminSupabaseClient, getServerUser } from "@/lib/supabase/server";
import { resolveOrgKey } from "@/lib/organizations/resolveOrgKey";
import { ReportFiltersClient } from "@/features/reporting/components/ReportFiltersClient";
import { RecentEnrollmentsTableV2, type RecentEnrollmentItemV2 } from "@/components/table-v2/RecentEnrollmentsTableV2";
import {
  fetchOrgReportStats,
  fetchEnrollmentsDaily,
  fetchEnrollmentSummaryPage,
  fetchTopCourses,
  fetchTopUsersByCertificates,
} from "@/services/reportingService";

export const fetchCache = "force-no-store";

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

export default async function OrgReportsPage({
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

  // Members should not access reports.
  if (user.role === "member") redirect(`/org/${orgSlug}`);

  // Org layout already enforces org membership for org_admin/member, but keep defense-in-depth.
  if (user.role === "organization_admin" && user.organization_id !== orgId) redirect("/unauthorized");

  const q = spGet(sp, "q") ?? "";
  const result = (spGet(sp, "result") ?? "all") as "all" | "certified" | "not_certified";
  const from = spGet(sp, "from") ?? "";
  const to = spGet(sp, "to") ?? "";
  const courseId = spGet(sp, "courseId") ?? "";
  const userId = spGet(sp, "userId") ?? "";
  const page = Number(spGet(sp, "page") ?? "1");
  const pageSize = 20;

  const admin = createAdminSupabaseClient();
  const [courseLookup, userLookup] = await Promise.all([
    courseId
      ? admin.from("courses").select("title").eq("id", courseId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    userId
      ? admin.from("users").select("full_name, email").eq("id", userId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const courseLabel = (courseLookup.data && typeof courseLookup.data.title === "string" ? courseLookup.data.title : "").trim();
  const userLabel = (
    (userLookup.data && typeof userLookup.data.full_name === "string" ? userLookup.data.full_name : "") ||
    (userLookup.data && typeof userLookup.data.email === "string" ? userLookup.data.email : "")
  ).trim();

  const filters = {
    organizationId: orgId,
    q: q || undefined,
    result,
    from: from || undefined,
    to: to || undefined,
    courseId: courseId || undefined,
    userId: userId || undefined,
  };

  const [stats, summaryPage, daily, topCoursesRes, topUsersRes] = await Promise.all([
    fetchOrgReportStats(orgId),
    fetchEnrollmentSummaryPage({ ...filters, page, pageSize }),
    fetchEnrollmentsDaily({
      organizationId: orgId,
      days: 90,
      from: from || undefined,
      to: to || undefined,
    }),
    fetchTopCourses({ ...filters, limit: 5 }),
    fetchTopUsersByCertificates({ ...filters, limit: 5 }),
  ]);

  const cards = [
    { label: ui("Total Users"), value: String(stats.usersCount), icon: Users },
    { label: ui("Enrollments"), value: String(stats.enrollmentsCount), icon: BookOpen },
    { label: ui("Certified"), value: String(stats.certifiedCount), icon: Award },
    { label: ui("Certification Rate"), value: `${stats.certificationRate}%`, icon: TrendingUp },
  ];

  const topCourses = topCoursesRes.rows;
  const topUsers = topUsersRes.rows;
  const maxDaily = Math.max(1, ...daily.points.map((p) => p.count));
  const hasDailyData = daily.points.some((p) => p.count > 0);

  const exportParams = new URLSearchParams();
  exportParams.set("orgId", orgId);
  if (q) exportParams.set("q", q);
  if (result && result !== "all") exportParams.set("result", result);
  if (from) exportParams.set("from", from);
  if (to) exportParams.set("to", to);
  if (courseId) exportParams.set("courseId", courseId);
  if (userId) exportParams.set("userId", userId);
  exportParams.set("max", "50000");
  const exportHref = `/api/reports/enrollments/export?${exportParams.toString()}`;

  const pagerParams = new URLSearchParams();
  if (q) pagerParams.set("q", q);
  if (result && result !== "all") pagerParams.set("result", result);
  if (from) pagerParams.set("from", from);
  if (to) pagerParams.set("to", to);
  if (courseId) pagerParams.set("courseId", courseId);
  if (userId) pagerParams.set("userId", userId);
  const pageHref = (p: number) => {
    const u = new URLSearchParams(pagerParams);
    u.set("page", String(p));
    return `?${u.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-8 w-8 text-primary shrink-0" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">{ui("Reports")}</h1>
            <p className="text-muted-foreground">{ui("Analytics and reports for your organization")}</p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button className="gap-2" asChild>
            <a href={exportHref}>
              <Download className="h-4 w-4" />
              {ui("Export CSV")}</a>
          </Button>
        </div>
      </div>

      {stats.error ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {ui("Some stats could not be loaded: ")}{stats.error}
        </div>
      ) : null}
      {summaryPage.error ? (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {ui("Failed to load report rows: ")}{summaryPage.error}
        </div>
      ) : null}
      {daily.error ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {ui("Enrollments chart not available: ")}{daily.error}
        </div>
      ) : null}
      {topCoursesRes.error ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {ui("Top courses not available: ")}{topCoursesRes.error}
        </div>
      ) : null}
      {topUsersRes.error ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {ui("Top users not available: ")}{topUsersRes.error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={ui(c.label)} className="bg-card border rounded-lg p-6 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-muted-foreground">{ui(c.label)}</p>
                  <p className="text-3xl font-bold text-foreground mt-1">{c.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{ui("Live")}</p>
                </div>
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon className="h-6 w-6 text-primary" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <ReportFiltersClient
        mode="org"
        orgIdFixed={orgId}
        initial={{
          q,
          result,
          from,
          to,
          orgId: orgId,
          courseId,
          courseLabel,
          userId,
          userLabel,
        }}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-card border rounded-lg p-6 shadow-sm lg:col-span-2">
          <h2 className="text-lg font-semibold text-foreground mb-4">{ui("Enrollments (daily)")}</h2>
          {hasDailyData ? (
            <>
              <div className="flex items-end gap-1 h-40">
                {daily.points.map((p) => (
                  <div key={p.day} className="flex-1 min-w-0">
                    <div
                      className="w-full rounded-sm bg-primary/80"
                      style={{ height: `${Math.round((p.count / maxDaily) * 100)}%` }}
                      title={`${p.day}: ${p.count}`}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                <span>{daily.points[0]?.day ?? ""}</span>
                <span>{daily.points[daily.points.length - 1]?.day ?? ""}</span>
              </div>
            </>
          ) : (
            <div className="flex h-40 items-center justify-center rounded-lg border border-dashed bg-muted/20 px-4 text-center text-sm text-muted-foreground">
              {ui("No enrollments in the selected period.")}</div>
          )}
        </div>

        <div className="bg-card border rounded-lg p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground mb-4">{ui("Top Courses")}</h2>
          <div className="space-y-3">
            {topCourses.length === 0 ? (
              <div className="text-sm text-muted-foreground">{ui("No data.")}</div>
            ) : (
              topCourses.map((c) => {
                const max = Math.max(1, topCourses[0]?.count ?? 1);
                const w = Math.round((c.count / max) * 100);
                return (
                  <div key={c.id}>
                    <div className="flex justify-between text-sm">
                      <span className="truncate">{ui(c.label)}</span>
                      <span className="tabular-nums text-muted-foreground">{c.count}</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden mt-1">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${w}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <h2 className="text-lg font-semibold text-foreground mb-4 mt-6">{ui("Top Users (by certificates)")}</h2>
          <div className="space-y-3">
            {topUsers.length === 0 ? (
              <div className="text-sm text-muted-foreground">{ui("No data.")}</div>
            ) : (
              topUsers.map((u) => {
                const max = Math.max(1, topUsers[0]?.count ?? 1);
                const w = Math.round((u.count / max) * 100);
                return (
                  <div key={u.id}>
                    <div className="flex justify-between text-sm">
                      <span className="truncate">{u.label}</span>
                      <span className="tabular-nums text-muted-foreground">{u.count}</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden mt-1">
                      <div className="h-full bg-green-600 rounded-full" style={{ width: `${w}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="bg-card border rounded-lg p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground mb-4">{ui("Enrollments")}</h2>

        <RecentEnrollmentsTableV2
          items={summaryPage.rows.map((r, idx): RecentEnrollmentItemV2 => {
            const userLabel =
              (r.user_full_name && r.user_full_name.trim().length > 0 ? r.user_full_name.trim() : null) ??
              (r.user_email && r.user_email.trim().length > 0 ? r.user_email.trim() : null) ??
              "Unknown user";
            const courseLabel = (r.course_title ?? "").trim() || "Untitled course";

            const id = `${r.organization_id}:${r.user_id}:${r.course_id}:${r.enrolled_at ?? idx}`;

            return {
              id,
              time: "—",
              timeIso: r.enrolled_at ?? null,
              organization: null,
              user: userLabel,
              course: courseLabel,
              result: r.certified ? "certified" : "not_certified",
              enrollmentStatus: r.enrollment_status,
              enrolledAt: r.enrolled_at,
              certificateIssuedAt: r.certificate_issued_at,
              meta: r,
            };
          })}
          emptyTitle={ui("No enrollments yet.")}
          emptySubtitle={ui("Once users enroll, their status and certificates will appear here.")}
        />

        <div className="mt-4 flex items-center justify-between gap-3 text-sm">
          <div className="text-muted-foreground">
            {summaryPage.count > 0 ? (
              <span>
                {ui("Showing ")}{(summaryPage.page - 1) * summaryPage.pageSize + 1}–
                {Math.min(summaryPage.page * summaryPage.pageSize, summaryPage.count)} {ui("of ")}{summaryPage.count}
              </span>
            ) : (
              <span>{ui("Showing 0 results")}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(() => {
              const totalPages = Math.max(1, summaryPage.totalPages);
              const current = Math.min(Math.max(1, summaryPage.page), totalPages);
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

                  <div className="text-muted-foreground tabular-nums hidden sm:block">
                    {ui("Page ")}{current} / {totalPages}
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
      </div>
    </div>
  );
}

