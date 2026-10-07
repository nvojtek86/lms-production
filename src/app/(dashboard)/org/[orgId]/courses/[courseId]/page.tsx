import {getCourseLocale} from "@/i18n/course";

import {getUi} from "@/i18n/server";
import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { BarChart3, BookOpen, Check, Clock, Layers } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createAdminSupabaseClient, createServerSupabaseClient, getServerUser } from "@/lib/supabase/server";
import { hasActiveOrganizationMembership } from "@/lib/organizations/memberships";
import { resolveOrgKey } from "@/lib/organizations/resolveOrgKey";
import { CourseEnrollActions } from "@/features/courses/components/CourseEnrollActions";
import { CourseContentPreview, type CourseContentTopic } from "@/features/courses/components/v2/CourseContentPreview";

type CourseRow = {
  id: string;
  slug?: string | null;
  title?: string | null;
  about_html?: string | null;
  cover_image_url?: string | null;
  created_at?: string | null;
  is_published?: boolean | null;
  organization_id?: string | null;
  visibility_scope?: "all" | "organizations" | null;
  difficulty_level?: "all_levels" | "beginner" | "intermediate" | "expert" | null;
  what_will_learn?: string | null;
  total_duration_hours?: number | null;
  total_duration_minutes?: number | null;
  materials_included?: string | null;
  requirements_instructions?: string | null;
  intro_video_provider?: "html5" | "youtube" | "vimeo" | null;
  intro_video_url?: string | null;
  intro_video_storage_path?: string | null;
  intro_video_mime?: string | null;
};

function difficultyLabel(v: CourseRow["difficulty_level"]): string {
  switch (v) {
    case "beginner":
      return "Beginner";
    case "intermediate":
      return "Intermediate";
    case "expert":
      return "Expert";
    case "all_levels":
    default:
      return "All levels";
  }
}

function splitBullets(input: string | null | undefined): string[] {
  if (!input) return [];
  const normalized = input
    .split(/\r?\n/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((line) => line.split("•").map((s) => s.trim()).filter(Boolean));
  return normalized.length ? normalized : [];
}

function hostMatches(hostname: string, baseDomain: string): boolean {
  return hostname === baseDomain || hostname.endsWith(`.${baseDomain}`);
}

function isUuidLike(input: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input);
}

function toYouTubeEmbedUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    let videoId: string | null = null;

    if (hostMatches(host, "youtu.be")) {
      videoId = u.pathname.replace(/^\/+/, "").split("/")[0] || null;
    } else if (hostMatches(host, "youtube.com")) {
      if (u.pathname.startsWith("/watch")) videoId = u.searchParams.get("v");
      else if (u.pathname.startsWith("/embed/")) videoId = u.pathname.split("/")[2] || null;
      else if (u.pathname.startsWith("/shorts/")) videoId = u.pathname.split("/")[2] || null;
    }

    if (!videoId) return null;
    return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
  } catch {
    return null;
  }
}

function toVimeoEmbedUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    if (!hostMatches(host, "vimeo.com")) return null;

    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    const id = /^\d+$/.test(last) ? last : null;
    if (!id) return null;
    return `https://player.vimeo.com/video/${encodeURIComponent(id)}`;
  } catch {
    return null;
  }
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

export default async function OrgCourseDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; courseId: string }>;
}) {
  let ui = await getUi();
  const { user, error } = await getServerUser();
  if (error || !user) redirect("/");

  const { orgId: orgKey, courseId: courseKey } = await params;
  const resolved = await resolveOrgKey(orgKey);
  const org = resolved.org;
  if (!org) {
    if (user.role === "organization_admin" || user.role === "member") redirect("/unauthorized");
    notFound();
  }

  const orgId = org.id; // UUID (DB/API)
  const orgSlug = org.slug; // canonical slug (links)

  const supabase = await createServerSupabaseClient();
  const uuidKey = isUuidLike(courseKey);
  const courseQuery = supabase
    .from("courses")
    .select(
      "id, slug, title, about_html, cover_image_url, created_at, is_published, organization_id, visibility_scope, difficulty_level, what_will_learn, total_duration_hours, total_duration_minutes, materials_included, requirements_instructions, intro_video_provider, intro_video_url, intro_video_storage_path, intro_video_mime"
    )
    .eq("organization_id", orgId);
  const { data, error: courseError } = await (uuidKey ? courseQuery.eq("id", courseKey) : courseQuery.eq("slug", courseKey)).single();

  if (courseError || !data) {
    redirect(`/org/${orgSlug}/courses`);
  }

  const course = data as CourseRow;
  const courseId = course.id;
  if (user.role === "member") ui = await getUi(await getCourseLocale(courseId));
  const courseSlug = typeof course.slug === "string" && course.slug.trim().length ? course.slug.trim() : null;
  const courseHrefKey = courseSlug ?? courseId;

  // Pretty URL: if user came via UUID but slug exists, redirect to slug.
  // Also normalize outdated slugs if they change.
  if (uuidKey && courseSlug) {
    redirect(`/org/${orgSlug}/courses/${courseSlug}`);
  }
  if (!uuidKey && courseSlug && courseSlug !== courseKey) {
    redirect(`/org/${orgSlug}/courses/${courseSlug}`);
  }

  // Members can open courses from any org where they have an active membership.
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

  // Org-only courses: enforce org-owned constraint on org pages.
  const isOrgOwned = course.organization_id === orgId;
  if (!isOrgOwned) {
    redirect(`/org/${orgSlug}/courses`);
  }

  const title = course.title ?? "(untitled)";
  const canEdit =
    user.role === "organization_admin" &&
    user.organization_id === orgId &&
    course.organization_id === orgId;

  let isEnrolled = false;
  if (user.role === "member") {
    if (course.is_published !== true) {
      // Members can only view published courses.
      redirect(`/org/${orgSlug}/courses`);
    }
    const { data: enr } = await supabase
      .from("course_enrollments")
      .select("id, status")
      .eq("course_id", courseId)
      .eq("user_id", user.id)
      .maybeSingle();
    isEnrolled = Boolean(enr?.id) && (enr as { status?: string | null }).status === "active";
  }

  const { data: topicRows } = await supabase
    .from("course_topics")
    .select("id, title, position")
    .eq("course_id", courseId)
    .order("position", { ascending: true });

  const { data: itemRows } = await supabase
    .from("course_topic_items")
    .select("id, topic_id, item_type, title, position, payload_json")
    .eq("course_id", courseId);

  const topics = (Array.isArray(topicRows) ? topicRows : [])
    .map((t) => ({
      id: String((t as { id?: unknown }).id ?? ""),
      title: String((t as { title?: unknown }).title ?? "").trim(),
    }))
    .filter((t) => t.id && t.title);

  const itemsByTopic = new Map<
    string,
    Array<{ id: string; item_type: "lesson" | "quiz"; title: string | null; position: number; payload_json: Record<string, unknown> | null }>
  >();
  for (const row of Array.isArray(itemRows) ? itemRows : []) {
    const topicId = String((row as { topic_id?: unknown }).topic_id ?? "");
    if (!topicId) continue;
    const type = String((row as { item_type?: unknown }).item_type ?? "");
    if (type !== "lesson" && type !== "quiz") continue;
    const arr = itemsByTopic.get(topicId) ?? [];
    arr.push({
      id: String((row as { id?: unknown }).id ?? ""),
      item_type: type as "lesson" | "quiz",
      title: typeof (row as { title?: unknown }).title === "string" ? ((row as { title: string }).title ?? null) : null,
      position: Number.isFinite(Number((row as { position?: unknown }).position)) ? Number((row as { position: number }).position) : 0,
      payload_json: (row as { payload_json?: unknown }).payload_json && typeof (row as { payload_json: unknown }).payload_json === "object"
        ? ((row as { payload_json: Record<string, unknown> }).payload_json ?? null)
        : null,
    });
    itemsByTopic.set(topicId, arr);
  }

  const contentTopics: CourseContentTopic[] = topics.map((t) => ({
    id: t.id,
    title: t.title,
    position: (topicRows as Array<{ id: string; position: number }> | null)?.find((r) => String(r.id) === t.id)?.position ?? 0,
    items: (itemsByTopic.get(t.id) ?? []).sort((a, b) => a.position - b.position),
  }));

  const learnBullets = splitBullets(course.what_will_learn);
  const requirementsBullets = splitBullets(course.requirements_instructions);

  let introVideo: { kind: "embed"; url: string } | { kind: "html5"; url: string; mime: string } | null = null;
  if (course.intro_video_provider === "html5" && course.intro_video_storage_path) {
    const admin = createAdminSupabaseClient();
    const signed = await admin.storage.from("course-intro-videos").createSignedUrl(course.intro_video_storage_path, 60 * 30);
    if (signed.data?.signedUrl) {
      introVideo = { kind: "html5", url: signed.data.signedUrl, mime: course.intro_video_mime || "video/mp4" };
    }
  } else if (course.intro_video_provider === "youtube" && course.intro_video_url) {
    const embed = toYouTubeEmbedUrl(course.intro_video_url);
    if (embed) introVideo = { kind: "embed", url: embed };
  } else if (course.intro_video_provider === "vimeo" && course.intro_video_url) {
    const embed = toVimeoEmbedUrl(course.intro_video_url);
    if (embed) introVideo = { kind: "embed", url: embed };
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 md:gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <BookOpen className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">{title}</h1>
            <p className="text-muted-foreground">
              {course.is_published ? ui("Published") : ui("Draft")}
            </p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row md:items-center gap-2 w-full md:w-auto">
          <Button variant="outline" asChild className="w-full md:w-auto">
            <Link href={`/org/${orgSlug}/courses`}>{ui("Back")}</Link>
          </Button>
          {canEdit ? (
            <Button asChild className="w-full md:w-auto">
              <Link href={`/org/${orgSlug}/courses/${courseId}/edit-v2`}>{ui("Edit")}</Link>
            </Button>
          ) : null}
          {user.role === "member" ? (
            <div className="w-full md:w-auto">
              <CourseEnrollActions
                orgId={orgSlug}
                courseId={courseId}
                courseHrefKey={courseHrefKey}
                isEnrolled={isEnrolled}
                disabled={course.is_published !== true}
                className="w-full md:w-auto justify-center"
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div
          className={`
            relative
            h-[350px] min-h-[350px]
            md:h-[400px] md:min-h-[400px]
            ${course.cover_image_url ? "" : pickCoverGradient(courseId)}
          `}
        >
          {course.cover_image_url ? (
            <Image
              src={course.cover_image_url}
              alt={ui("{v0} cover", {v0: title})}
              fill
              className="object-cover"
              sizes="(max-width: 1024px) 100vw, 900px"
            />
          ) : null}
          <div className="absolute inset-0 bg-linear-to-t from-black/35 via-black/10 to-transparent" />
        </div>

        {introVideo ? (
          <div className="border-t bg-background p-4 sm:p-6">
            <div className="mx-auto w-full max-w-4xl">
              <div className="relative aspect-video overflow-hidden rounded-xl border bg-black">
                {introVideo.kind === "embed" ? (
                  <iframe
                    className="absolute inset-0 h-full w-full"
                    src={introVideo.url}
                    title={ui("Course intro video")}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                ) : (
                  <video className="absolute inset-0 h-full w-full" controls preload="metadata">
                    <source src={introVideo.url} type={introVideo.mime} />
                  </video>
                )}
              </div>
            </div>
          </div>
        ) : null}

        <div className="p-4 sm:p-6 space-y-6 sm:space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-lg border bg-background p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <BarChart3 className="h-4 w-4 text-primary" />
                {ui("Difficulty")}</div>
              <p className="mt-2 text-sm text-muted-foreground">{ui(difficultyLabel(course.difficulty_level ?? "all_levels"))}</p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Clock className="h-4 w-4 text-primary" />
                {ui("Total duration")}</div>
              <p className="mt-2 text-sm text-muted-foreground">
                {(course.total_duration_hours ?? 0)}h {(course.total_duration_minutes ?? 0)}m
              </p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Layers className="h-4 w-4 text-primary" />
                {ui("Curriculum")}</div>
              <p className="mt-2 text-sm text-muted-foreground">{topics.length} {ui("topic(s)")}</p>
            </div>
          </div>

          {learnBullets.length ? (
            <div className="rounded-xl border bg-muted/10 p-4 sm:p-6">
              <h2 className="text-lg font-semibold">{ui("What you’ll learn")}</h2>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
                {learnBullets.slice(0, 12).map((b, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-primary" />
                    <p className="text-sm text-foreground">{b}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <h2 className="text-lg font-semibold">{ui("About this course")}</h2>
            <div className="mt-3 prose prose-sm max-w-none text-foreground">
              {course.about_html?.trim() ? (
                <div dangerouslySetInnerHTML={{ __html: course.about_html }} />
              ) : (
                <p className="text-muted-foreground">{ui("No description yet.")}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {user.role === "member" && !isEnrolled
                ? ui("Preview the curriculum — items unlock after enrollment.")
                : ui("Curriculum overview.")}
            </p>
            <CourseContentPreview topics={contentTopics} locked={user.role === "member" && !isEnrolled} />
          </div>

          <div className="space-y-6">
            <div className="rounded-xl border bg-muted/10 p-4 sm:p-6">
              <h2 className="text-lg font-semibold">{ui("Materials included")}</h2>
              <p className="mt-3 text-sm whitespace-pre-wrap text-muted-foreground">{course.materials_included?.trim() || "—"}</p>
            </div>
            <div className="rounded-xl border bg-muted/10 p-4 sm:p-6">
              <h2 className="text-lg font-semibold">{ui("Requirements")}</h2>
              {requirementsBullets.length ? (
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {requirementsBullets.slice(0, 24).map((r, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-muted-foreground/70" />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">—</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

