
import {getUi} from "@/i18n/server";
import Link from "next/link";
import Image from "next/image";
import { BookOpen, Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { createServerSupabaseClient, getServerUser } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { getUserOrganizationMemberships } from "@/lib/organizations/memberships";
import { resolveOrgKey } from "@/lib/organizations/resolveOrgKey";

type CourseRow = {
  id: string;
  slug?: string | null;
  title?: string | null;
  description?: string | null;
  excerpt?: string | null;
  cover_image_url?: string | null;
  created_at?: string | null;
  is_published?: boolean | null;
  visibility_scope?: "all" | "organizations" | null;
  organization_id?: string | null;
};

function truncateWords(text: string, maxWords: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(" ") + "…";
}

function formatDate(iso: string, locale = "en") {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(locale, { year: "numeric", month: "short", day: "2-digit" });
}

function currentIsoTimestamp() {
  return new Date().toISOString();
}

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

// Title is visually clamped to keep equal card heights.
// Full title remains accessible via the `title` attribute.
const titleClampStyle = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical" as const,
  overflow: "hidden",
};

export default async function CoursesPage({ params }: { params: Promise<{ orgId: string }> }) {
  const ui = await getUi();
  const { user, error } = await getServerUser();
  if (error || !user) return null;

  const { orgId: orgKey } = await params;
  const resolved = await resolveOrgKey(orgKey);
  const org = resolved.org;
  if (!org) {
    if (user.role === "organization_admin" || user.role === "member") return null;
    notFound();
  }

  const orgId = org.id; // UUID (DB/API)
  const orgSlug = org.slug; // canonical slug (links)

  const supabase = await createServerSupabaseClient();

  let coursesError: { message: string } | null = null;
  let coursesData: CourseRow[] = [];
  const membershipOrgMeta = new Map<string, { label: string; slug: string }>();
  const nowIso = currentIsoTimestamp();

  if (user.role === "member") {
    const { memberships, error: membershipsError } = await getUserOrganizationMemberships(user.id, {
      roles: ["member"],
      activeOnly: true,
    });
    if (membershipsError) {
      coursesError = { message: membershipsError };
    } else {
      memberships.forEach((membership) => {
        const label = membership.organizationName ?? membership.organizationSlug ?? membership.organizationId;
        const slug = membership.organizationSlug ?? membership.organizationId;
        membershipOrgMeta.set(membership.organizationId, { label, slug });
      });

      const membershipOrgIds = memberships.map((membership) => membership.organizationId);
      if (membershipOrgIds.length > 0) {
        const { data: assignmentRows, error: assignmentsError } = await supabase
          .from("course_member_assignments")
          .select("course_id, organization_id, access_expires_at")
          .eq("user_id", user.id)
          .in("organization_id", membershipOrgIds);

        if (assignmentsError) {
          coursesError = { message: assignmentsError.message };
        } else {
          const assignedCourseIds = Array.from(
            new Set(
              (Array.isArray(assignmentRows) ? assignmentRows : [])
                .filter((row) => {
                  const expiresAt = (row as { access_expires_at?: string | null }).access_expires_at ?? null;
                  return !expiresAt || expiresAt > nowIso;
                })
                .map((row) => ((row as { course_id?: unknown }).course_id as string | null) ?? null)
                .filter((value): value is string => typeof value === "string" && value.length > 0)
            )
          );

          if (assignedCourseIds.length > 0) {
            const { data, error } = await supabase
              .from("courses")
              .select("id, slug, title, description, excerpt, cover_image_url, created_at, is_published, visibility_scope, organization_id")
              .in("id", assignedCourseIds)
              .eq("is_published", true)
              .order("created_at", { ascending: false })
              .limit(200);

            coursesData = (Array.isArray(data) ? data : []) as CourseRow[];
            if (error) coursesError = { message: error.message };
          }
        }
      }
    }
  } else {
    const { data, error } = await supabase
      .from("courses")
      .select("id, slug, title, description, excerpt, cover_image_url, created_at, is_published, visibility_scope, organization_id")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(200);

    coursesData = (Array.isArray(data) ? data : []) as CourseRow[];
    if (error) coursesError = { message: error.message };
  }

  const courses = (Array.isArray(coursesData) ? coursesData : []) as CourseRow[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <BookOpen className="h-8 w-8 text-primary shrink-0" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">{ui("Courses")}</h1>
            <p className="text-muted-foreground">
              {user.role === "member"
                ? ui("Assigned published courses from all organizations you belong to.")
                : ui("Your Journey Begins with a Single Lesson.")}
            </p>
          </div>
        </div>

        {user.role === "organization_admin" && user.organization_id === orgId ? (
          <Button asChild className="shrink-0">
            <Link href={`/org/${orgSlug}/courses/new-v2`}>
              <Plus className="h-4 w-4" />
              {ui("Create course")}</Link>
          </Button>
        ) : null}
      </div>

      {coursesError ? (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {ui("Failed to load courses: ")}{coursesError.message}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {courses.length === 0 ? (
          <div className="col-span-full rounded-lg border bg-card p-10 text-center text-muted-foreground">
            {user.role === "member" ? ui("No assigned courses available yet.") : ui("No courses available yet.")}
          </div>
        ) : (
          courses.map((course) => {
            const title = course.title ?? "(untitled)";
            const excerpt = (course.excerpt ?? course.description ?? "").trim();
            const createdAt = course.created_at ?? "";
            const isOwnedByOrg = course.organization_id === orgId;
            const courseOrgMeta =
              (typeof course.organization_id === "string" ? membershipOrgMeta.get(course.organization_id) : null) ?? null;
            const authorLabel =
              user.role === "member"
                ? (courseOrgMeta?.label ?? "Assigned organization")
                : isOwnedByOrg
                  ? "Your organization"
                  : "ISO LMS";
            const status = course.is_published ? "published" : "draft";
            const courseOrgKey =
              user.role === "member"
                ? (courseOrgMeta?.slug ?? orgSlug)
                : orgSlug;

            const canEdit =
              user.role === "organization_admin" && user.organization_id === orgId && isOwnedByOrg;

            return (
              <article
                key={course.id}
                className="h-[420px] rounded-xl border bg-card shadow-sm overflow-hidden transition-all hover:shadow-md hover:-translate-y-0.5"
              >
                <div className={`h-40 relative ${course.cover_image_url ? "" : pickCoverGradient(course.id)}`}>
                  {course.cover_image_url ? (
                    <Image
                      src={course.cover_image_url}
                      alt={ui("{v0} cover", {v0: title})}
                      fill
                      className="object-cover"
                      sizes="(max-width: 1024px) 100vw, 420px"
                    />
                  ) : null}
                  <div className="absolute inset-0 bg-linear-to-t from-black/35 via-black/10 to-transparent" />
                  <div className="absolute left-4 bottom-4 flex items-center gap-2 text-white/90">
                    <div className="h-9 w-9 rounded-lg bg-white/15 ring-1 ring-white/20 backdrop-blur flex items-center justify-center">
                      <BookOpen className="h-5 w-5" />
                    </div>
                    <span className="text-xs font-medium tracking-wide uppercase">{ui("Course")}</span>
                  </div>
                </div>

                <div className="p-5 h-[calc(420px-10rem)] flex flex-col">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/80">{authorLabel}</span>
                    <time dateTime={createdAt}>{createdAt ? formatDate(createdAt, ui.locale) : "—"}</time>
                  </div>

                  <h3
                    className="mt-3 text-base font-semibold text-foreground leading-snug"
                    style={titleClampStyle}
                    title={title}
                  >
                    {title}
                  </h3>

                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    {excerpt ? truncateWords(excerpt, 20) : ui("No excerpt yet.")}
                  </p>

                  <div className="mt-auto pt-4 flex items-center justify-between gap-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        status === "published" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {status}
                    </span>

                    <div className="flex items-center gap-2">
                      {canEdit ? (
                        <Button size="sm" variant="secondary" asChild>
                          <Link href={`/org/${courseOrgKey}/courses/${course.id}/edit-v2`}>{ui("Edit")}</Link>
                        </Button>
                      ) : null}
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/org/${courseOrgKey}/courses/${(course.slug ?? "").trim() || course.id}`}>{ui("View")}</Link>
                      </Button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}

