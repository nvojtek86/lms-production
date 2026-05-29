import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { BookOpen, Play, CheckCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createServerSupabaseClient, getServerUser } from "@/lib/supabase/server";
import { getUserOrganizationMemberships } from "@/lib/organizations/memberships";
import { resolveOrgKey } from "@/lib/organizations/resolveOrgKey";

export const fetchCache = "force-no-store";

type CourseRow = {
  id: string;
  slug?: string | null;
  title: string | null;
  excerpt: string | null;
  is_published: boolean | null;
  cover_image_url?: string | null;
  builder_version?: number | null;
  created_at?: string | null;
  organization_id?: string | null;
};

type CourseAccessRow = {
  course_id: string | null;
  organization_id: string | null;
  access_expires_at: string | null;
};

function pickCoverGradient(seed: string) {
  const gradients = [
    "bg-gradient-to-br from-indigo-500 via-purple-500 to-fuchsia-500",
    "bg-gradient-to-br from-slate-700 via-slate-800 to-black",
    "bg-gradient-to-br from-rose-500 via-red-500 to-amber-500",
    "bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500",
    "bg-gradient-to-br from-blue-500 via-sky-500 to-cyan-400",
    "bg-gradient-to-br from-violet-500 via-purple-500 to-pink-500",
    "bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500",
    "bg-gradient-to-br from-green-500 via-emerald-500 to-lime-400",
    "bg-gradient-to-br from-neutral-700 via-zinc-800 to-slate-900",
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return gradients[hash % gradients.length];
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function accessPill(expiresAtIso: string | null): { label: string; className: string } {
  if (!expiresAtIso) return { label: "Unlimited", className: "bg-slate-100 text-slate-800" };
  const ms = new Date(expiresAtIso).getTime();
  if (!Number.isFinite(ms)) return { label: "Expires —", className: "bg-slate-100 text-slate-800" };

  const diffMs = ms - Date.now();
  if (diffMs <= 0) return { label: "Expired", className: "bg-red-100 text-red-800" };

  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 1) return { label: "Less than 1 day left", className: "bg-amber-100 text-amber-800" };
  if (diffDays <= 14) return { label: `${diffDays} days left`, className: "bg-amber-100 text-amber-800" };
  return { label: `Expires ${formatShortDate(expiresAtIso)}`, className: "bg-slate-100 text-slate-800" };
}

export default async function StudentMyCoursesPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { user, error } = await getServerUser();
  if (error || !user) redirect("/");

  const { orgId: orgKey } = await params;
  const resolved = await resolveOrgKey(orgKey);
  const org = resolved.org;
  if (!org) {
    if (user.role === "organization_admin" || user.role === "member") redirect("/unauthorized");
    notFound();
  }

  const orgSlug = org.slug; // canonical slug (links)

  if (user.role !== "member") redirect(`/org/${orgSlug}`);

  const supabase = await createServerSupabaseClient();
  const { memberships, error: membershipsError } = await getUserOrganizationMemberships(user.id, {
    roles: ["member"],
    activeOnly: true,
  });
  if (membershipsError) {
    throw new Error(membershipsError);
  }

  const membershipOrgIds = memberships.map((membership) => membership.organizationId);
  const membershipOrgMeta = new Map(
    memberships.map((membership) => [
      membership.organizationId,
      {
        label: membership.organizationName ?? membership.organizationSlug ?? membership.organizationId,
        slug: membership.organizationSlug ?? membership.organizationId,
      },
    ])
  );

  const { data: enrollments } = await supabase
    .from("course_enrollments")
    .select("course_id, status, organization_id")
    .eq("user_id", user.id)
    .in("organization_id", membershipOrgIds.length > 0 ? membershipOrgIds : ["00000000-0000-0000-0000-000000000000"])
    .eq("status", "active");

  const courseIds = (Array.isArray(enrollments) ? enrollments : [])
    .map((r: { course_id?: string | null }) => r.course_id)
    .filter((v): v is string => typeof v === "string");

  const { data: accessRowsData } =
    courseIds.length > 0
      ? await supabase
          .from("course_member_assignments")
          .select("course_id, organization_id, access_expires_at")
          .eq("user_id", user.id)
          .in("organization_id", membershipOrgIds.length > 0 ? membershipOrgIds : ["00000000-0000-0000-0000-000000000000"])
          .in("course_id", courseIds)
      : { data: [] };

  const accessExpiresByCourseId: Record<string, string | null> = {};
  for (const r of (Array.isArray(accessRowsData) ? accessRowsData : []) as CourseAccessRow[]) {
    const cid = typeof r.course_id === "string" ? r.course_id : null;
    if (!cid) continue;
    accessExpiresByCourseId[cid] = typeof r.access_expires_at === "string" ? r.access_expires_at : null;
  }

  const { data: coursesData } =
    courseIds.length > 0
      ? await supabase
          .from("courses")
          .select("id, slug, title, excerpt, is_published, cover_image_url, builder_version, created_at, organization_id")
          .in("id", courseIds)
          .eq("is_published", true)
          .order("created_at", { ascending: false })
      : { data: [] };

  const coursesAll = (Array.isArray(coursesData) ? coursesData : []) as CourseRow[];

  const v2CourseIds = coursesAll
    .filter((c) => (c.builder_version ?? null) === 2)
    .map((c) => c.id);

  // V2 progress: total items + visits.
  const { data: v2ItemsData } = v2CourseIds.length
    ? await supabase.from("course_topic_items").select("id, course_id").in("course_id", v2CourseIds)
    : { data: [] };
  const { data: v2VisitsData } = v2CourseIds.length
    ? await supabase
        .from("course_v2_item_visits")
        .select("course_id, item_id, visited_at")
        .in("course_id", v2CourseIds)
        .eq("user_id", user.id)
    : { data: [] };

  const totalByCourse: Record<string, number> = {};
  for (const it of (Array.isArray(v2ItemsData) ? v2ItemsData : []) as Array<{ course_id?: string | null }>) {
    if (!it.course_id) continue;
    totalByCourse[it.course_id] = (totalByCourse[it.course_id] || 0) + 1;
  }

  const completedByCourse: Record<string, number> = {};
  for (const v of (Array.isArray(v2VisitsData) ? v2VisitsData : []) as Array<{ course_id?: string | null; visited_at?: string | null }>) {
    if (!v.course_id) continue;
    if (!v.visited_at) continue;
    // For V2 we treat "visited" as progress for now.
    completedByCourse[v.course_id] = (completedByCourse[v.course_id] || 0) + 1;
  }

  const derivedStatus = (courseId: string) => {
    const total = totalByCourse[courseId] || 0;
    const done = completedByCourse[courseId] || 0;
    if (total > 0 && done >= total) return "completed";
    if (done > 0) return "in_progress";
    return "not_started";
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "completed":
        return { label: "Completed", class: "bg-green-100 text-green-800" };
      case "in_progress":
        // Member is actively enrolled and has started (visited progress exists).
        return { label: "Enrolling", class: "bg-blue-100 text-blue-800" };
      default:
        return { label: "Not Started", class: "bg-gray-100 text-gray-800" };
    }
  };

  // V2-only: legacy (builder_version != 2) courses are no longer supported.
  // My Courses should show only started/in-progress courses (not-started belongs in Courses catalog).
  const courses = coursesAll
    .filter((c) => (c.builder_version ?? null) === 2)
    .filter((c) => derivedStatus(c.id) !== "not_started");

  const inProgressCount = courses.filter((c) => derivedStatus(c.id) === "in_progress").length;
  const completedCount = courses.filter((c) => derivedStatus(c.id) === "completed").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BookOpen className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Courses</h1>
          <p className="text-muted-foreground">Track your learning progress</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border rounded-lg p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-lg bg-blue-100 flex items-center justify-center">
              <Play className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">In Progress</p>
              <p className="text-2xl font-bold text-foreground">{inProgressCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-card border rounded-lg p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-lg bg-green-100 flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Completed</p>
              <p className="text-2xl font-bold text-foreground">{completedCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-card border rounded-lg p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center">
              <BookOpen className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total</p>
              <p className="text-2xl font-bold text-foreground">{courses.length}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {courses.length === 0 ? (
          <div className="col-span-full rounded-lg border bg-card p-10 text-center text-muted-foreground">
            You have not started any courses yet.
          </div>
        ) : (
          courses.map((course) => {
            const status = derivedStatus(course.id);
            const statusInfo = getStatusLabel(status);
            const accessInfo = accessPill(accessExpiresByCourseId[course.id] ?? null);
            const total = totalByCourse[course.id] || 0;
            const done = completedByCourse[course.id] || 0;
            const progress = total > 0 ? Math.round((done / total) * 100) : 0;
            const title = (course.title ?? "").trim() || "(untitled)";
            const excerpt = (course.excerpt ?? "").trim();
            const orgMeta =
              (typeof course.organization_id === "string" ? membershipOrgMeta.get(course.organization_id) : null) ?? null;
            const courseOrgKey = orgMeta?.slug ?? orgSlug;

            const coverUrl = (course.cover_image_url ?? "").trim();

            return (
              <article
                key={course.id}
                className="rounded-xl border bg-card shadow-sm overflow-hidden transition-all hover:shadow-md hover:-translate-y-0.5"
              >
                <div className={`h-36 relative ${coverUrl ? "" : pickCoverGradient(course.id)}`}>
                  {coverUrl ? (
                    <Image
                      src={coverUrl}
                      alt={`${title} cover`}
                      fill
                      className="object-cover"
                      sizes="(max-width: 1024px) 100vw, 520px"
                    />
                  ) : null}
                  <div className="absolute inset-0 bg-linear-to-t from-black/40 via-black/10 to-transparent" />
                  <div className="absolute left-4 bottom-4 flex items-center gap-2 text-white/90">
                    <div className="h-9 w-9 rounded-lg bg-white/15 ring-1 ring-white/20 backdrop-blur flex items-center justify-center">
                      <BookOpen className="h-5 w-5" />
                    </div>
                    <span className="text-xs font-medium tracking-wide uppercase">My course</span>
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-lg font-semibold text-foreground truncate">{title}</h3>
                      <p className="mt-1 text-xs font-medium text-foreground/70">{orgMeta?.label ?? "Organization"}</p>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{excerpt || "No excerpt yet."}</p>
                    </div>
                    <div className="shrink-0 flex flex-wrap items-center justify-end gap-2">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusInfo.class}`}>
                        {statusInfo.label}
                      </span>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${accessInfo.className}`}>
                        {accessInfo.label}
                      </span>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">Progress</span>
                      <span className="font-medium text-foreground">
                        {done}/{total} • {progress}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${progress === 100 ? "bg-green-500" : "bg-primary"}`} style={{ width: `${progress}%` }} />
                    </div>
                  </div>

                  <Button className="w-full gap-2" asChild>
                    <Link href={`/org/${courseOrgKey}/courses/${(course.slug ?? "").trim() || course.id}/learn`}>
                      <Play className="h-4 w-4" />
                      Continue Learning
                    </Link>
                  </Button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}

