
import {useUi} from "@/i18n/useUi";

import {getUi} from "@/i18n/server";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { LayoutDashboard, Users, BookOpen, Award, TrendingUp } from "lucide-react";
import { createAdminSupabaseClient, getServerUser } from "@/lib/supabase/server";
import { getUserOrganizationMemberships, hasActiveOrganizationMembership } from "@/lib/organizations/memberships";
import { resolveOrgKey } from "@/lib/organizations/resolveOrgKey";
import { fetchEnrollmentSummary } from "@/services/reportingService";
import { RecentActivityTableV2, type RecentActivityItemV2 } from "@/components/table-v2/RecentActivityTableV2";

type Stat = { label: string; value: string; icon: typeof Users; color: string; error?: string | null };

export const fetchCache = "force-no-store";

async function safeCount(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  table: string,
  filters?: Array<{ column: string; value: unknown }>
) {
  try {
    let q = admin.from(table).select("*", { count: "exact", head: true });
    for (const f of filters ?? []) {
      q = q.eq(f.column, f.value);
    }
    const { count, error } = await q;
    return { count: typeof count === "number" ? count : 0, error: error?.message ?? null };
  } catch (e) {
    return { count: 0, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

interface OrgDashboardProps {
  params: Promise<{ orgId: string }>;
}

export default async function OrgDashboardPage({ params }: OrgDashboardProps) {
  const ui = await getUi();
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

  // Security: prevent org admins/members from guessing other org URLs.
  if (user.role === "organization_admin" || user.role === "member") {
    const { hasMembership } = await hasActiveOrganizationMembership(
      user.id,
      orgId,
      user.role === "organization_admin" ? ["organization_admin"] : ["member"]
    );
    if (!hasMembership) {
      redirect("/unauthorized");
    }
  }

  const admin = createAdminSupabaseClient();

  const canSeeUsersCard = user.role !== "member";
  const noopCount = { count: 0, error: null as string | null };

  const [{ data: orgRow }, usersTotal, usersDisabled, courses, certificates] = await Promise.all([
    admin.from("organizations").select("id, name, slug, logo_url").eq("id", orgId).single(),
    canSeeUsersCard ? safeCount(admin, "users", [{ column: "organization_id", value: orgId }]) : Promise.resolve(noopCount),
    canSeeUsersCard ? safeCount(admin, "users", [
      { column: "organization_id", value: orgId },
      { column: "is_active", value: false },
    ]) : Promise.resolve(noopCount),
    safeCount(admin, "courses", [{ column: "organization_id", value: orgId }]),
    safeCount(admin, "certificates", [{ column: "organization_id", value: orgId }]),
  ]);

  // Treat NULL as active (matches app semantics: only explicit false is disabled)
  let disabledUsersCount = usersDisabled.count;
  let activeUsersCount = Math.max(0, usersTotal.count - disabledUsersCount);
  let usersCountError = usersTotal.error || usersDisabled.error;

  const orgName = (orgRow as { name?: unknown } | null)?.name;
  const orgSlugFromRow = (orgRow as { slug?: unknown } | null)?.slug;
  const orgLogoUrl = (orgRow as { logo_url?: unknown } | null)?.logo_url;
  const orgLabel =
    typeof orgName === "string" && orgName.trim().length > 0
      ? orgName.trim()
      : typeof orgSlugFromRow === "string" && orgSlugFromRow.trim().length > 0
        ? orgSlugFromRow.trim()
        : orgSlug || orgId;

  if (user.role === "member") {
    const { memberships, error: membershipsError } = await getUserOrganizationMemberships(user.id, {
      roles: ["member"],
      activeOnly: true,
    });

    const membershipOrgIds = memberships.map((membership) => membership.organizationId);
    const membershipNames = memberships.map(
      (membership) => membership.organizationName ?? membership.organizationSlug ?? membership.organizationId
    );

    const [{ data: assignmentRows, error: assignmentsError }, certificatesResult] = await Promise.all([
      membershipOrgIds.length > 0
        ? admin
            .from("course_member_assignments")
            .select("course_id, access_expires_at, organization_id")
            .eq("user_id", user.id)
            .in("organization_id", membershipOrgIds)
        : Promise.resolve({ data: [], error: null }),
      membershipOrgIds.length > 0
        ? admin
            .from("certificates")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id)
            .in("organization_id", membershipOrgIds)
        : Promise.resolve({ count: 0, error: null }),
    ]);

    const certificateCount = membershipOrgIds.length > 0 ? certificatesResult.count ?? 0 : 0;

    const assignedCourseCount = Array.from(
      new Set(
        (Array.isArray(assignmentRows) ? assignmentRows : [])
          .filter((row) => {
            const expiresAt = (row as { access_expires_at?: string | null }).access_expires_at ?? null;
            if (!expiresAt) return true;
            const expiresAtMs = new Date(expiresAt).getTime();
            return !Number.isFinite(expiresAtMs) || expiresAtMs > Date.now();
          })
          .map((row) => ((row as { course_id?: unknown }).course_id as string | null) ?? null)
          .filter((value): value is string => typeof value === "string" && value.length > 0)
      )
    ).length;

    const memberStats: Stat[] = [
      {
        label: ui("Organizations"),
        value: String(memberships.length),
        icon: Users,
        color: "bg-blue-500",
        error: membershipsError,
      },
      {
        label: ui("Assigned Courses"),
        value: String(assignedCourseCount),
        icon: BookOpen,
        color: "bg-purple-500",
        error: assignmentsError?.message ?? null,
      },
      {
        label: ui("Total Issued Certificates"),
        value: String(certificateCount),
        icon: Award,
        color: "bg-amber-500",
        error: certificatesResult.error?.message ?? null,
      },
    ];

    return (
      <div className="space-y-6">
        <div className="flex flex-col items-start gap-3">
          {typeof orgLogoUrl === "string" && orgLogoUrl.trim().length > 0 ? (
            <div className="my-5 flex h-12 w-auto items-center justify-center overflow-hidden rounded bg-transparent">
              <Image
                src={orgLogoUrl}
                alt={ui("{v0} logo", {v0: orgLabel})}
                width={160}
                height={64}
                className="h-full w-full object-contain"
                priority
              />
            </div>
          ) : (
            <LayoutDashboard className="h-8 w-8 text-primary" />
          )}
          <div>
            <h1 className="text-2xl font-bold text-foreground">{ui("Organization Dashboard")}</h1>
            <p className="text-muted-foreground">
              {ui("You belong to ")}<span className="font-medium text-foreground">{memberships.length}</span>{" "}
              {memberships.length === 1 ? ui("organization") : ui("organizations")}.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {user.full_name && user.full_name.trim().length > 0 ? ui("Welcome back, {v0}", {v0: user.full_name.trim()}) : ui("Welcome back")}
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {memberStats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="rounded-lg border bg-card p-6 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className={`h-12 w-12 rounded-lg ${stat.color} flex items-center justify-center`}>
                    <Icon className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                    <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                    {stat.error ? <p className="text-xs text-destructive">{stat.error}</p> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <TrendingUp className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">{ui("Your Organizations")}</h2>
              <p className="text-sm text-muted-foreground">{ui("All active organizations linked to your account.")}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {membershipNames.length > 0 ? (
              membershipNames.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center rounded-full border bg-muted/40 px-3 py-1 text-sm text-foreground"
                >
                  {name}
                </span>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{ui("No active organizations found.")}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (user.role === "organization_admin") {
    const membershipLookup = await getUserOrganizationMemberships(user.id, {
      roles: ["organization_admin"],
      activeOnly: true,
    });
    if (!membershipLookup.error) {
      const orgMembership = membershipLookup.memberships.find((membership) => membership.organizationId === orgId);
      if (orgMembership) {
        const memberIdsLookup = await createAdminSupabaseClient()
          .from("organization_memberships")
          .select("user_id")
          .eq("organization_id", orgId)
          .eq("is_active", true)
          .in("role", ["member", "organization_admin"]);

        if (memberIdsLookup.error) {
          usersCountError = memberIdsLookup.error.message;
        } else {
          const userIds = Array.from(
            new Set(
              (Array.isArray(memberIdsLookup.data) ? memberIdsLookup.data : [])
                .map((row) => ((row as { user_id?: unknown }).user_id as string | null) ?? null)
                .filter((value): value is string => typeof value === "string" && value.length > 0)
            )
          );

          if (userIds.length > 0) {
            const { data: orgUsers, error: orgUsersError } = await admin
              .from("users")
              .select("id, is_active")
              .in("id", userIds)
              .is("deleted_at", null);

            if (orgUsersError) {
              usersCountError = orgUsersError.message;
            } else {
              const visibleOrgUsers = Array.isArray(orgUsers) ? orgUsers : [];
              const disabledCount = visibleOrgUsers.filter((row) => (row as { is_active?: boolean | null }).is_active === false).length;
              disabledUsersCount = disabledCount;
              activeUsersCount = Math.max(0, visibleOrgUsers.length - disabledCount);
            }
          } else {
            disabledUsersCount = 0;
            activeUsersCount = 0;
          }
        }
      }
    }
  }

  const stats: Stat[] = [
    ...(canSeeUsersCard
      ? [
          {
            label: ui("Users (Active / Disabled)"),
            value: `${activeUsersCount} / ${disabledUsersCount}`,
            icon: Users,
            color: "bg-blue-500",
            error: usersCountError,
          },
        ]
      : []),
    { label: ui("Courses"), value: String(courses.count), icon: BookOpen, color: "bg-purple-500", error: courses.error },
    { label: ui("Total Issued Certificates"), value: String(certificates.count), icon: Award, color: "bg-amber-500", error: certificates.error },
  ];

  // Course progress (org admin & above)
  type CourseProgressRow = {
    course_id: string;
    course_title: string;
    enrolled: number;
    certified: number;
    not_certified: number;
    certification_rate: number; // 0..1
  };

  let courseProgressError: string | null = null;
  let courseProgressRows: CourseProgressRow[] = [];

  const summary = await fetchEnrollmentSummary({ organizationId: orgId, limit: 50000 });
  if (summary.error) courseProgressError = summary.error;
  else {
    const byCourse: Record<string, { title: string; enrolled: number; certified: number }> = {};
    for (const r of summary.rows) {
      const cid = r.course_id;
      const title = (r.course_title ?? "").trim() || "Untitled course";
      byCourse[cid] = byCourse[cid] || { title, enrolled: 0, certified: 0 };
      byCourse[cid].enrolled += 1;
      if (r.certified) byCourse[cid].certified += 1;
    }

    courseProgressRows = Object.entries(byCourse)
      .map(([course_id, v]) => {
        const not_certified = Math.max(0, v.enrolled - v.certified);
        const certification_rate = v.enrolled > 0 ? v.certified / v.enrolled : 0;
        return {
          course_id,
          course_title: v.title,
          enrolled: v.enrolled,
          certified: v.certified,
          not_certified,
          certification_rate,
        };
      })
      .sort((a, b) => b.enrolled - a.enrolled)
      .slice(0, 8);
  }

  // Recent activity (org-scoped): enrollments, certificates issued.
  type ActivityEvent = { ts: string; type: "enrolled" | "certificate_issued"; user_id: string | null; course_id: string | null };
  type ActivityEventDisplay = ActivityEvent & { user_label: string; course_label: string };

  let activityError: string | null = null;
  let activityEvents: ActivityEventDisplay[] = [];

  try {
    const [{ data: enrollRows, error: enrollErr }, { data: certRows, error: certErr }] = await Promise.all([
      admin
        .from("course_enrollments")
        .select("user_id, course_id, enrolled_at")
        .eq("organization_id", orgId)
        .order("enrolled_at", { ascending: false })
        .limit(12),
      admin
        .from("certificates")
        .select("user_id, course_id, issued_at, created_at, status")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(12),
    ]);

    const firstErr = enrollErr?.message ?? certErr?.message ?? null;
    if (firstErr) {
      activityError = firstErr;
    } else {
      const events: ActivityEvent[] = [];

      for (const r of (Array.isArray(enrollRows) ? enrollRows : []) as Array<{ user_id?: string | null; course_id?: string | null; enrolled_at?: string | null }>) {
        const ts = typeof r.enrolled_at === "string" ? r.enrolled_at : null;
        if (!ts) continue;
        events.push({ ts, type: "enrolled", user_id: r.user_id ?? null, course_id: r.course_id ?? null });
      }

      for (const r of (Array.isArray(certRows) ? certRows : []) as Array<{ user_id?: string | null; course_id?: string | null; issued_at?: string | null; created_at?: string | null }>) {
        const ts = (typeof r.issued_at === "string" ? r.issued_at : null) ?? (typeof r.created_at === "string" ? r.created_at : null);
        if (!ts) continue;
        events.push({ ts, type: "certificate_issued", user_id: r.user_id ?? null, course_id: r.course_id ?? null });
      }

      // Hydrate user/course/test labels for the small recent set
      const userIds = Array.from(new Set(events.map((e) => e.user_id).filter((v): v is string => typeof v === "string" && v.length > 0)));
      const courseIds = Array.from(new Set(events.map((e) => e.course_id).filter((v): v is string => typeof v === "string" && v.length > 0)));

      const [{ data: usersData }, { data: coursesData }] = await Promise.all([
        userIds.length > 0 ? admin.from("users").select("id, full_name, email").in("id", userIds) : Promise.resolve({ data: [] }),
        courseIds.length > 0 ? admin.from("courses").select("id, title").in("id", courseIds) : Promise.resolve({ data: [] }),
      ]);

      const userLabelById = new Map<string, string>();
      for (const u of (Array.isArray(usersData) ? usersData : []) as Array<{ id?: unknown; full_name?: unknown; email?: unknown }>) {
        const id = typeof u.id === "string" ? u.id : null;
        if (!id) continue;
        const fullName = typeof u.full_name === "string" && u.full_name.trim().length ? u.full_name.trim() : null;
        const email = typeof u.email === "string" && u.email.trim().length ? u.email.trim() : null;
        userLabelById.set(id, fullName ?? email ?? id);
      }

      const courseLabelById = new Map<string, string>();
      for (const c of (Array.isArray(coursesData) ? coursesData : []) as Array<{ id?: unknown; title?: unknown }>) {
        const id = typeof c.id === "string" ? c.id : null;
        if (!id) continue;
        const title = typeof c.title === "string" && c.title.trim().length ? c.title.trim() : null;
        courseLabelById.set(id, title ?? "Untitled course");
      }

      // Final render list (most recent first)
      activityEvents = events
        .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
        .slice(0, 12)
        .map((e) => ({
          ...e,
          user_label: e.user_id ? (userLabelById.get(e.user_id) ?? e.user_id) : "Unknown user",
          course_label: e.course_id ? (courseLabelById.get(e.course_id) ?? e.course_id) : "Unknown course",
        }));
    }
  } catch (e) {
    activityError = e instanceof Error ? e.message : "Failed to load activity";
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col items-start gap-3">
        {typeof orgLogoUrl === "string" && orgLogoUrl.trim().length > 0 ? (
          <div className="h-12 w-auto rounded bg-transparent my-5 flex items-center justify-center overflow-hidden">
            <Image
              src={orgLogoUrl}
              alt={ui("{v0} logo", {v0: orgLabel})}
              width={160}
              height={64}
              className="h-full w-full object-contain"
              priority
            />
          </div>
        ) : (
          <LayoutDashboard className="h-8 w-8 text-primary" />
        )}
        <div>
          <h1 className="text-2xl font-bold text-foreground">{ui("Organization Dashboard")}</h1>
          <p className="text-muted-foreground">
            {typeof orgName === "string" && orgName.trim().length > 0 ? ui("Organization Name") : ui("Organization")}:{" "}
            <span className="font-medium text-foreground">{orgLabel}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {user.full_name && user.full_name.trim().length > 0
              ? ui("Welcome back, {v0}", {v0: user.full_name.trim()})
              : ui("Welcome back")}
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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

      {/* Quick Overview Panels */}
      <div className="grid grid-cols-1 md:grid-cols-1 gap-6">
        <div className="bg-card border rounded-lg p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            {ui("Course Progress")}</h2>
          {courseProgressError ? (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {ui("Failed to load course progress: ")}{courseProgressError}
            </div>
          ) : courseProgressRows.length === 0 ? (
            <div className="text-muted-foreground text-center py-8">
              <p>{ui("No enrollments yet.")}</p>
              <p className="text-sm mt-2">{ui("Once users enroll, course progress will show here.")}</p>
            </div>
          ) : (
            <div className="rounded-lg border">
              <div className="w-full overflow-x-auto">
                <table className="min-w-max w-full">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">{ui("Course")}</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">{ui("Enrollments")}</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">{ui("Certified")}</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">{ui("Not certified")}</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">{ui("Certification rate")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {courseProgressRows.map((r) => {
                    const pct = Math.round((Number.isFinite(r.certification_rate) ? r.certification_rate : 0) * 100);
                    return (
                      <tr key={r.course_id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="min-w-[220px]">
                            <div className="font-medium text-foreground">{r.course_title}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-foreground tabular-nums">{r.enrolled}</td>
                        <td className="px-4 py-3 text-right text-sm text-foreground tabular-nums">{r.certified}</td>
                        <td className="px-4 py-3 text-right text-sm text-foreground tabular-nums">{r.not_certified}</td>
                        <td className="px-4 py-3 text-right text-sm text-foreground whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-green-500" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                            </div>
                            <span className="tabular-nums">{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="bg-card border rounded-lg p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            {ui("Recent Activity")}</h2>
          {activityError ? (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {ui("Failed to load activity: ")}{activityError}
            </div>
          ) : activityEvents.length === 0 ? (
            <div className="text-muted-foreground text-center py-8">
              <p>{ui("No recent activity yet.")}</p>
              <p className="text-sm mt-2">{ui("Enrollments and certificates will appear here.")}</p>
            </div>
          ) : (
            <RecentActivityTableV2
              items={activityEvents.map((e, idx): RecentActivityItemV2 => {
                const actor = e.user_label; // Option 1: Actor = user_label
                const subject = e.course_label; // Option 1: Subject = course_label

                let title = "";
                if (e.type === "enrolled") title = "Enrolled";
                else if (e.type === "certificate_issued") title = "Certificate issued";
                const details = null;

                return {
                  id: `${e.type}-${e.ts}-${idx}`,
                  time: "—",
                  timeIso: e.ts ?? null,
                  actor,
                  subject,
                  title,
                  details,
                  meta: e,
                };
              })}
              emptyTitle={ui("No recent activity yet.")}
              emptySubtitle={ui("Enrollments and certificates will appear here.")}
            />
          )}
        </div>
      </div>
    </div>
  );
}

