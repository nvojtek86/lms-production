import {getCourseLocale} from "@/i18n/course";

import {getUi} from "@/i18n/server";
import { notFound, redirect } from "next/navigation";
import { BookOpen } from "lucide-react";

import { createAdminSupabaseClient, createServerSupabaseClient, getServerUser } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { CourseLearnV2Client, type LearnV2Topic } from "@/features/courses/components/v2";
import { resolveOrgKey } from "@/lib/organizations/resolveOrgKey";
import { sanitizeRichHtml } from "@/lib/courses/sanitize.server";

export const fetchCache = "force-no-store";

type CourseRow = {
  id: string;
  slug?: string | null;
  title: string | null;
  is_published: boolean | null;
  builder_version?: number | null;
  organization_id?: string | null;
};

function isUuidLike(input: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input);
}

function isSafeStoragePath(input: string): boolean {
  if (!input.trim()) return false;
  if (input.length > 600) return false;
  if (input.includes("..")) return false;
  if (input.startsWith("/")) return false;
  return true;
}

function normalizeQuizOptionImageUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value) return null;
  if (value.startsWith("data:image/")) return value;

  try {
    const parsed = new URL(value, "http://local.invalid");
    if (parsed.origin !== "http://local.invalid") return null;
    if (parsed.pathname !== "/api/v2/lesson-assets") return null;

    const storagePath = parsed.searchParams.get("path");
    if (!storagePath || !isSafeStoragePath(storagePath)) return null;

    return `/api/v2/lesson-assets?path=${encodeURIComponent(storagePath)}`;
  } catch {
    return null;
  }
}

export default async function CourseLearnPage({
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
  const orgSlug = org.slug;

  // This page is for members learning flow.
  if (user.role !== "member") {
    redirect(`/org/${orgSlug}/courses/${courseKey}`);
  }

  const supabase = await createServerSupabaseClient();

  // Resolve course key (slug or UUID) to UUID.
  const uuidKey = isUuidLike(courseKey);
  const admin = createAdminSupabaseClient();
  const courseLookup = admin
    .from("courses")
    .select("id, slug, title, is_published, builder_version, organization_id")
    .eq("organization_id", org.id);
  const { data: course, error: courseError } = await (uuidKey ? courseLookup.eq("id", courseKey) : courseLookup.eq("slug", courseKey)).single();

  if (courseError || !course) {
    redirect(`/org/${orgSlug}/courses`);
  }

  const courseId = String((course as CourseRow).id);
  if (user.role === "member") ui = await getUi(await getCourseLocale(courseId));
  const courseSlug = typeof (course as CourseRow).slug === "string" && (course as CourseRow).slug!.trim().length ? (course as CourseRow).slug!.trim() : null;
  const courseHrefKey = courseSlug ?? courseId;

  // Pretty URL: if user came via UUID but slug exists, redirect to slug.
  if (uuidKey && courseSlug) {
    redirect(`/org/${orgSlug}/courses/${courseSlug}/learn`);
  }
  if (!uuidKey && courseSlug && courseSlug !== courseKey) {
    redirect(`/org/${orgSlug}/courses/${courseSlug}/learn`);
  }

  // Ensure enrolled (RLS allows member read own enrollment).
  const { data: enrollment } = await supabase
    .from("course_enrollments")
    .select("id, status")
    .eq("course_id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!enrollment?.id || enrollment.status !== "active") {
    redirect(`/org/${orgSlug}/courses/${courseHrefKey}`);
  }

  if ((course as CourseRow).is_published !== true) {
    // Members can only learn published courses.
    redirect(`/org/${orgSlug}/courses/${courseHrefKey}`);
  }

  const courseTitle = ((course as CourseRow).title ?? "").trim() || "(untitled)";
  const builderVersion = (course as CourseRow).builder_version ?? null;

  // V2 learning flow: course topics/items (lessons/quizzes)
  if (builderVersion === 2) {
    const [{ data: topicRows }, { data: itemRows }, { data: resumeRow }, { data: visitRows }, { data: quizStateRows }] = await Promise.all([
      supabase.from("course_topics").select("id, title, position").eq("course_id", courseId).order("position", { ascending: true }),
      supabase
        .from("course_topic_items")
        .select("id, topic_id, item_type, title, position, payload_json")
        .eq("course_id", courseId)
        .order("position", { ascending: true }),
      supabase
        .from("course_v2_resume_state")
        .select("last_item_id")
        .eq("course_id", courseId)
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("course_v2_item_visits")
        .select("item_id")
        .eq("course_id", courseId)
        .eq("user_id", user.id),
      supabase
        .from("course_v2_quiz_state")
        .select("item_id, best_score_percent, passed_at, last_submitted_attempt_id")
        .eq("course_id", courseId)
        .eq("user_id", user.id),
    ]);

    async function signFromLessonBucket(storage_path: string): Promise<string | null> {
      const signed = await admin.storage.from("course-lesson-assets").createSignedUrl(storage_path, 60 * 30);
      return signed.data?.signedUrl ?? null;
    }

    const itemsByTopic = new Map<string, Array<Record<string, unknown>>>();
    for (const row of Array.isArray(itemRows) ? itemRows : []) {
      const topicId = String((row as { topic_id?: unknown }).topic_id ?? "");
      if (!topicId) continue;
      const arr = itemsByTopic.get(topicId) ?? [];
      arr.push(row as Record<string, unknown>);
      itemsByTopic.set(topicId, arr);
    }

    const topics: LearnV2Topic[] = [];
    for (const t of Array.isArray(topicRows) ? topicRows : []) {
      const topicId = String((t as { id?: unknown }).id ?? "");
      const title = String((t as { title?: unknown }).title ?? "").trim();
      if (!topicId || !title) continue;
      const position = Number((t as { position?: unknown }).position ?? 0) || 0;

      const rawItems = itemsByTopic.get(topicId) ?? [];
      const items = await Promise.all(
        rawItems.map(async (row) => {
          const id = String((row as { id?: unknown }).id ?? "");
          const item_type = String((row as { item_type?: unknown }).item_type ?? "");
          if (!id || (item_type !== "lesson" && item_type !== "quiz")) return null;

          const title = typeof (row as { title?: unknown }).title === "string" ? (((row as { title: string }).title ?? "").trim() || "(untitled)") : "(untitled)";
          const position = Number((row as { position?: unknown }).position ?? 0) || 0;
          const payload_json =
            (row as { payload_json?: unknown }).payload_json && typeof (row as { payload_json: unknown }).payload_json === "object"
              ? ((row as { payload_json: Record<string, unknown> }).payload_json ?? {})
              : {};

          if (item_type === "lesson") {
            const p = payload_json as Record<string, unknown>;
            const rawBlocks = Array.isArray((p as { content_blocks?: unknown }).content_blocks)
              ? ((p as { content_blocks: unknown[] }).content_blocks as unknown[])
              : null;

            const content_blocks = (rawBlocks ?? [])
              .map((v) => (typeof v === "string" ? v : ""))
              .map((html) => sanitizeRichHtml(html) ?? "")
              .map((html) => html.trim())
              .filter((html) => html.length > 0);

            // Backwards-compat: if only content_html exists and it contains <hr>, split into blocks
            // so the learner UI can render with spacing (no visible <hr>).
            const legacyHtml = sanitizeRichHtml(typeof p.content_html === "string" ? p.content_html : "") ?? "";
            const legacyBlocks = legacyHtml
              ? legacyHtml
                  .split(/<hr\b[^>]*>/i)
                  .map((s) => (s ?? "").trim())
                  .filter(Boolean)
              : [];

            const effectiveBlocks = content_blocks.length > 0 ? content_blocks : legacyBlocks;
            const cleanHtml = effectiveBlocks.length > 0 ? effectiveBlocks.join("\n\n") : legacyHtml;
            const playback = (p.playback_time ?? null) as { hours?: unknown; minutes?: unknown } | null;
            const ph = playback ? Number(playback.hours) : 0;
            const pm = playback ? Number(playback.minutes) : 0;
            const duration_minutes =
              (Number.isFinite(ph) ? Math.max(0, Math.floor(ph)) : 0) * 60 +
              (Number.isFinite(pm) ? Math.max(0, Math.floor(pm)) : 0);

            const featurePath =
              p.feature_image && typeof p.feature_image === "object" && (p.feature_image as { storage_path?: unknown }).storage_path
                ? String((p.feature_image as { storage_path: unknown }).storage_path)
                : null;
            const feature_image_url = featurePath ? await signFromLessonBucket(featurePath) : null;

            const videoObj = p.video && typeof p.video === "object" ? (p.video as Record<string, unknown>) : {};
            const provider = String(videoObj.provider ?? "");
            const videoUrl = typeof videoObj.url === "string" ? videoObj.url : null;
            const videoStoragePath = typeof videoObj.storage_path === "string" ? videoObj.storage_path : null;

            let video: { kind: "html5"; url: string; mime: string } | { kind: "embed"; url: string } | null = null;
            if (provider === "html5" && videoStoragePath) {
              const signed = await signFromLessonBucket(videoStoragePath);
              if (signed) video = { kind: "html5", url: signed, mime: "video/mp4" };
            } else if ((provider === "youtube" || provider === "vimeo") && videoUrl) {
              // embed URL is generated client-side for now (we pass the raw URL)
              video = { kind: "embed", url: videoUrl };
            }

            const rawAttachments = Array.isArray(p.attachments) ? (p.attachments as unknown[]) : [];
            const attachments = (
              await Promise.all(
                rawAttachments.map(async (a) => {
                  if (!a || typeof a !== "object") return null;
                  const file_name = typeof (a as { file_name?: unknown }).file_name === "string" ? (a as { file_name: string }).file_name : "Attachment";
                  const storage_path = typeof (a as { storage_path?: unknown }).storage_path === "string" ? (a as { storage_path: string }).storage_path : "";
                  if (!storage_path) return null;
                  const url = await signFromLessonBucket(storage_path);
                  if (!url) return null;
                  const size_bytes = Number.isFinite(Number((a as { size_bytes?: unknown }).size_bytes)) ? Number((a as { size_bytes: number }).size_bytes) : null;
                  const mime = typeof (a as { mime?: unknown }).mime === "string" ? (a as { mime: string }).mime : null;
                  return { file_name, url, size_bytes, mime };
                })
              )
            ).filter(Boolean) as Array<{ file_name: string; url: string; size_bytes: number | null; mime: string | null }>;

            return {
              id,
              item_type: "lesson" as const,
              title,
              position,
              lesson: {
                content_html: cleanHtml,
                content_blocks: effectiveBlocks,
                feature_image_url,
                video,
                attachments,
                duration_minutes: duration_minutes > 0 ? duration_minutes : null,
              },
            };
          }

          // quiz (v1): pass full payload so learner UI can render + take it.
          const qp = payload_json as Record<string, unknown>;
          const kind = typeof qp.kind === "string" ? qp.kind : null;

          const summary_html = sanitizeRichHtml(typeof qp.summary === "string" ? qp.summary : "") ?? "";
          const rawQuestions = Array.isArray(qp.questions) ? (qp.questions as unknown[]) : [];
          const rawSettings = qp.settings && typeof qp.settings === "object" ? (qp.settings as Record<string, unknown>) : {};

          const questions = rawQuestions
            .map((q) => {
              if (!q || typeof q !== "object") return null;
              const qq = q as Record<string, unknown>;
              const id = typeof qq.id === "string" ? qq.id : "";
              if (!id) return null;
              const type = typeof qq.type === "string" ? qq.type : "single_choice";
              const title = typeof qq.title === "string" ? qq.title : "";
              const answer_required = Boolean(qq.answer_required ?? true);
              const randomize = Boolean(qq.randomize ?? false);
              const points = Number.isFinite(Number(qq.points)) ? Math.max(0, Math.floor(Number(qq.points))) : 1;
              const display_points = Boolean(qq.display_points ?? false);
              const description_html = sanitizeRichHtml(typeof qq.description_html === "string" ? qq.description_html : "") ?? "";
              const answer_explanation_html = sanitizeRichHtml(typeof qq.answer_explanation_html === "string" ? qq.answer_explanation_html : "") ?? "";
              const rawOptions = Array.isArray(qq.options) ? (qq.options as unknown[]) : [];
              const options = rawOptions
                .map((o, idx) => {
                  if (!o || typeof o !== "object") return null;
                  const oo = o as Record<string, unknown>;
                  const optId = typeof oo.id === "string" ? oo.id : "";
                  if (!optId) return null;
                  const optTitle = typeof oo.title === "string" ? oo.title : "";
                  const image_data_url = normalizeQuizOptionImageUrl(oo.image_data_url);
                  const display_format =
                    oo.display_format === "only_image" || oo.display_format === "text_and_image_both" ? String(oo.display_format) : "only_text";
                  const position = Number.isFinite(Number(oo.position)) ? Number(oo.position) : idx;
                  return { id: optId, title: optTitle, image_data_url, display_format, position };
                })
                .filter((x): x is NonNullable<typeof x> => Boolean(x))
                .slice()
                .sort((a, b) => a.position - b.position);

              return {
                id,
                title,
                type,
                answer_required,
                randomize,
                points,
                display_points,
                description_html,
                answer_explanation_html,
                options,
              };
            })
            .filter((x): x is NonNullable<typeof x> => Boolean(x));

          const settings = {
            time_limit_value: Number.isFinite(Number(rawSettings.time_limit_value)) ? Math.max(0, Math.floor(Number(rawSettings.time_limit_value))) : 0,
            time_limit_unit:
              rawSettings.time_limit_unit === "seconds" || rawSettings.time_limit_unit === "hours" ? String(rawSettings.time_limit_unit) : "minutes",
            hide_quiz_time_display: Boolean(rawSettings.hide_quiz_time_display ?? false),
            feedback_mode: rawSettings.feedback_mode === "reveal" || rawSettings.feedback_mode === "retry" ? String(rawSettings.feedback_mode) : "default",
            attempts_allowed: Number.isFinite(Number(rawSettings.attempts_allowed)) ? Math.max(0, Math.floor(Number(rawSettings.attempts_allowed))) : 0,
            passing_grade_percent: Number.isFinite(Number(rawSettings.passing_grade_percent))
              ? Math.max(0, Math.min(100, Math.floor(Number(rawSettings.passing_grade_percent))))
              : 80,
            max_questions_allowed_to_answer: Number.isFinite(Number(rawSettings.max_questions_allowed_to_answer))
              ? Math.max(1, Math.floor(Number(rawSettings.max_questions_allowed_to_answer)))
              : 10,
          };

          return {
            id,
            item_type: "quiz" as const,
            title,
            position,
            quiz: {
              kind,
              summary_html,
              questions,
              settings,
            },
          };
        })
      );

      const resolvedItems = items
        .filter((it): it is NonNullable<typeof it> => Boolean(it))
        .sort((a, b) => a.position - b.position) as LearnV2Topic["items"];

      topics.push({
        id: topicId,
        title,
        position,
        items: resolvedItems,
      });
    }

    const initialSelectedItemId =
      resumeRow && typeof (resumeRow as { last_item_id?: unknown }).last_item_id === "string"
        ? String((resumeRow as { last_item_id: string }).last_item_id)
        : null;
    const initialVisitedItemIds = (Array.isArray(visitRows) ? visitRows : [])
      .map((r) => (r as { item_id?: unknown }).item_id)
      .filter((v): v is string => typeof v === "string");

    const initialQuizStateByItemId: Record<
      string,
      { best_score_percent: number | null; passed_at: string | null; last_submitted_attempt_id: string | null }
    > = {};
    for (const row of Array.isArray(quizStateRows) ? quizStateRows : []) {
      const itemId = typeof (row as { item_id?: unknown }).item_id === "string" ? String((row as { item_id: string }).item_id) : "";
      if (!itemId) continue;
      const best =
        Number.isFinite(Number((row as { best_score_percent?: unknown }).best_score_percent))
          ? Number((row as { best_score_percent: number }).best_score_percent)
          : null;
      const passed_at = typeof (row as { passed_at?: unknown }).passed_at === "string" ? String((row as { passed_at: string }).passed_at) : null;
      const last_submitted_attempt_id =
        typeof (row as { last_submitted_attempt_id?: unknown }).last_submitted_attempt_id === "string"
          ? String((row as { last_submitted_attempt_id: string }).last_submitted_attempt_id)
          : null;
      initialQuizStateByItemId[itemId] = { best_score_percent: best, passed_at, last_submitted_attempt_id };
    }

    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <BookOpen className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">{ui("Course learning")}</h1>
              <p className="text-muted-foreground">{courseTitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href={`/org/${orgSlug}/courses/${courseHrefKey}`}>{ui("Back")}</Link>
            </Button>
          </div>
        </div>

        <CourseLearnV2Client
          orgId={orgSlug}
          courseId={courseId}
          courseTitle={courseTitle}
          topics={topics}
          initialSelectedItemId={initialSelectedItemId}
          initialVisitedItemIds={initialVisitedItemIds}
          initialQuizStateByItemId={initialQuizStateByItemId}
        />
      </div>
    );
  }

  // Legacy (V1) learning flow is removed; V2-only learning is supported.
  redirect(`/org/${orgSlug}/courses/${courseHrefKey}`);
}

