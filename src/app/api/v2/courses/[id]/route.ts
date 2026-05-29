import { NextRequest } from "next/server";
import { createAdminSupabaseClient, getServerUser } from "@/lib/supabase/server";
import { apiError, apiOk } from "@/lib/api/response";
import { logApiEvent } from "@/lib/audit/apiEvents";
import { generateSupportId } from "@/lib/support/supportId";
import { patchCourseV2Schema, validateSchema } from "@/lib/validations/schemas";
import { coerceNullableText, coursePermalink, ensureUniqueCourseSlug } from "@/lib/courses/v2";
import { sanitizeRichHtml } from "@/lib/courses/sanitize.server";
import { generateAndPersistCertificatePdf } from "@/lib/certificates/generateCertificatePdf";

type CourseRow = {
  id: string;
  organization_id: string | null;
  title: string | null;
  slug: string | null;
  status: "draft" | "published" | null;
  is_published: boolean | null;
  about_html: string | null;
  excerpt: string | null;
  difficulty_level: "all_levels" | "beginner" | "intermediate" | "expert" | null;
  what_will_learn: string | null;
  total_duration_hours: number | null;
  total_duration_minutes: number | null;
  materials_included: string | null;
  requirements_instructions: string | null;
  intro_video_provider: "html5" | "youtube" | "vimeo" | null;
  intro_video_url: string | null;
  intro_video_storage_path: string | null;
  intro_video_size_bytes: number | null;
  intro_video_mime: string | null;
  cover_image_url: string | null;
  thumbnail_storage_path: string | null;
  builder_version: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export const runtime = "nodejs";

function isSafeStoragePath(input: string): boolean {
  if (!input.trim()) return false;
  if (input.length > 600) return false;
  if (input.includes("..")) return false;
  if (input.startsWith("/")) return false;
  return true;
}

function extractStoragePathsFromText(htmlOrText: string, out: Set<string>) {
  const re = /\/api\/v2\/(?:course-assets|lesson-assets)\?path=([^"'&\s>]+)/g;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(htmlOrText))) {
    const raw = m[1] ?? "";
    if (!raw) continue;
    try {
      const decoded = decodeURIComponent(raw);
      if (isSafeStoragePath(decoded)) out.add(decoded);
    } catch {
      // ignore
    }
  }
}

function collectCourseAssetPathsFromHtml(html: string | null): Set<string> {
  const out = new Set<string>();
  if (typeof html === "string" && html.trim().length) extractStoragePathsFromText(html, out);
  return out;
}

function collectStoragePathsFromJson(value: unknown, out: Set<string>) {
  if (!value) return;
  if (typeof value === "string") {
    extractStoragePathsFromText(value, out);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStoragePathsFromJson(v, out);
    return;
  }
  if (typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  for (const [key, nested] of Object.entries(obj)) {
    if (key === "storage_path" && typeof nested === "string" && isSafeStoragePath(nested)) {
      out.add(nested);
      continue;
    }
    collectStoragePathsFromJson(nested, out);
  }
}

async function enqueueAssetDeletion(input: {
  admin: ReturnType<typeof createAdminSupabaseClient>;
  bucketId: string;
  objectName: string;
  requestedBy: string;
  reason: string;
}) {
  const rpc = await input.admin.rpc("enqueue_asset_deletion", {
    p_bucket_id: input.bucketId,
    p_object_name: input.objectName,
    p_delay_seconds: 60 * 60 * 2,
    p_requested_by: input.requestedBy,
    p_reason: input.reason,
  });
  return rpc.error?.message ?? null;
}

function isOrgAdminOwner(caller: { role: string; organization_id?: string | null }, course: { organization_id: string | null }): boolean {
  return caller.role === "organization_admin" && !!caller.organization_id && caller.organization_id === course.organization_id;
}

function parseExternalVideoUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function hostMatches(hostname: string, baseDomain: string): boolean {
  return hostname === baseDomain || hostname.endsWith(`.${baseDomain}`);
}

function isYouTubeUrl(parsed: URL): boolean {
  const host = parsed.hostname.toLowerCase();
  if (host === "youtu.be" || hostMatches(host, "youtu.be")) return parsed.pathname.length > 1;
  if (!hostMatches(host, "youtube.com")) return false;
  if (parsed.pathname.startsWith("/watch")) return parsed.searchParams.has("v");
  if (parsed.pathname.startsWith("/shorts/")) return true;
  if (parsed.pathname.startsWith("/embed/")) return true;
  return false;
}

function isVimeoUrl(parsed: URL): boolean {
  const host = parsed.hostname.toLowerCase();
  if (!hostMatches(host, "vimeo.com")) return false;
  return parsed.pathname.length > 1;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { user: caller, error } = await getServerUser();
  if (error || !caller) {
    return apiError("UNAUTHORIZED", "Unauthorized", { status: 401 });
  }

  if (caller.role !== "organization_admin") {
    return apiError("FORBIDDEN", "Forbidden", { status: 403 });
  }

  const admin = createAdminSupabaseClient();

  const { data: courseData, error: courseError } = await admin
    .from("courses")
    .select(
      "id, organization_id, title, slug, status, is_published, about_html, excerpt, difficulty_level, what_will_learn, total_duration_hours, total_duration_minutes, materials_included, requirements_instructions, intro_video_provider, intro_video_url, intro_video_storage_path, intro_video_size_bytes, intro_video_mime, cover_image_url, thumbnail_storage_path, builder_version, created_at, updated_at"
    )
    .eq("id", id)
    .single();

  if (courseError || !courseData) {
    return apiError("NOT_FOUND", "Course not found.", { status: 404 });
  }

  const course = courseData as CourseRow;
  if (!isOrgAdminOwner(caller, course)) {
    return apiError("FORBIDDEN", "Forbidden", { status: 403 });
  }

  const [{ data: topicsData }, { data: itemsData }, { data: assignedData }, { data: orgRow }] = await Promise.all([
    admin
      .from("course_topics")
      .select("id, title, summary, position, created_at, updated_at")
      .eq("course_id", id)
      .order("position", { ascending: true }),
    admin
      .from("course_topic_items")
      .select("id, topic_id, item_type, title, position, payload_json, is_required, created_at, updated_at")
      .eq("course_id", id)
      .order("position", { ascending: true }),
    admin.from("course_member_assignments").select("user_id").eq("course_id", id).eq("organization_id", caller.organization_id!),
    admin.from("organizations").select("slug").eq("id", caller.organization_id!).maybeSingle(),
  ]);

  const orgSlug = typeof orgRow?.slug === "string" && orgRow.slug.trim().length > 0 ? orgRow.slug.trim() : caller.organization_id!;
  const origin = new URL(request.url).origin;
  const permalink = coursePermalink({
    origin,
    orgSlug,
    slug: course.slug ?? "course",
  });

  const assignedMemberIds = (Array.isArray(assignedData) ? assignedData : [])
    .map((r) => r.user_id)
    .filter((v): v is string => typeof v === "string");

  const itemsByTopic = new Map<string, Array<Record<string, unknown>>>();
  for (const row of Array.isArray(itemsData) ? itemsData : []) {
    const topicId = typeof row.topic_id === "string" ? row.topic_id : "";
    if (!topicId) continue;
    const arr = itemsByTopic.get(topicId) ?? [];
    arr.push({
      id: row.id,
      item_type: row.item_type,
      title: row.title,
      position: row.position,
      payload_json: row.payload_json ?? {},
      is_required: row.is_required ?? true,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
    itemsByTopic.set(topicId, arr);
  }

  const topics = (Array.isArray(topicsData) ? topicsData : []).map((t) => ({
    id: t.id,
    title: t.title,
    summary: t.summary,
    position: t.position,
    created_at: t.created_at,
    updated_at: t.updated_at,
    items: itemsByTopic.get(t.id) ?? [],
  }));

  return apiOk(
    {
      course: {
        ...course,
        permalink,
        assigned_member_ids: assignedMemberIds,
      },
      topics,
    },
    { status: 200 }
  );
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { user: caller, error } = await getServerUser();
  if (error || !caller) {
    await logApiEvent({ request, caller: null, outcome: "error", status: 401, code: "UNAUTHORIZED", publicMessage: "Unauthorized" });
    return apiError("UNAUTHORIZED", "Unauthorized", { status: 401 });
  }

  if (caller.role !== "organization_admin" || !caller.organization_id) {
    await logApiEvent({ request, caller, outcome: "error", status: 403, code: "FORBIDDEN", publicMessage: "Forbidden" });
    return apiError("FORBIDDEN", "Forbidden", { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = validateSchema(patchCourseV2Schema, body);
  if (!parsed.success) {
    await logApiEvent({ request, caller, outcome: "error", status: 400, code: "VALIDATION_ERROR", publicMessage: parsed.error });
    return apiError("VALIDATION_ERROR", parsed.error, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data: currentData, error: currentError } = await admin
    .from("courses")
    .select("id, organization_id, title, slug, intro_video_provider, intro_video_url, about_html")
    .eq("id", id)
    .single();

  if (currentError || !currentData) {
    return apiError("NOT_FOUND", "Course not found.", { status: 404 });
  }
  if ((currentData.organization_id ?? null) !== caller.organization_id) {
    return apiError("FORBIDDEN", "Forbidden", { status: 403 });
  }

  const patch = parsed.data;
  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (Object.prototype.hasOwnProperty.call(patch, "title")) {
    updatePayload.title = patch.title?.trim();
  }

  if (Object.prototype.hasOwnProperty.call(patch, "slug")) {
    if (patch.slug) {
      try {
        updatePayload.slug = await ensureUniqueCourseSlug({
          organizationId: caller.organization_id,
          titleOrSlug: patch.slug,
          excludeCourseId: id,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Slug conflict";
        return apiError("CONFLICT", message, { status: 409 });
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, "about_html")) {
    updatePayload.about_html = sanitizeRichHtml(patch.about_html);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "excerpt")) {
    updatePayload.excerpt = coerceNullableText(patch.excerpt);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "difficulty_level")) {
    updatePayload.difficulty_level = patch.difficulty_level;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "what_will_learn")) {
    updatePayload.what_will_learn = coerceNullableText(patch.what_will_learn);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "total_duration_hours")) {
    updatePayload.total_duration_hours = patch.total_duration_hours;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "total_duration_minutes")) {
    updatePayload.total_duration_minutes = patch.total_duration_minutes;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "materials_included")) {
    updatePayload.materials_included = coerceNullableText(patch.materials_included);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "requirements_instructions")) {
    updatePayload.requirements_instructions = coerceNullableText(patch.requirements_instructions);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "intro_video_provider")) {
    updatePayload.intro_video_provider = patch.intro_video_provider;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "intro_video_url")) {
    updatePayload.intro_video_url = coerceNullableText(patch.intro_video_url);
  }

  const resolvedProvider =
    typeof updatePayload.intro_video_provider === "string"
      ? (updatePayload.intro_video_provider as "html5" | "youtube" | "vimeo")
      : (currentData.intro_video_provider ?? null);
  const resolvedVideoUrl =
    typeof updatePayload.intro_video_url === "string"
      ? (updatePayload.intro_video_url as string)
      : (currentData.intro_video_url ?? null);

  if (resolvedProvider && resolvedProvider !== "html5" && resolvedVideoUrl) {
    const parsedVideoUrl = parseExternalVideoUrl(resolvedVideoUrl);
    if (!parsedVideoUrl) {
      return apiError("VALIDATION_ERROR", "Invalid intro video URL.", { status: 400 });
    }
    if (resolvedProvider === "youtube" && !isYouTubeUrl(parsedVideoUrl)) {
      return apiError("VALIDATION_ERROR", "Please provide a full YouTube URL.", { status: 400 });
    }
    if (resolvedProvider === "vimeo" && !isVimeoUrl(parsedVideoUrl)) {
      return apiError("VALIDATION_ERROR", "Please provide a full Vimeo URL.", { status: 400 });
    }
  }

  const shouldDiffAbout = Object.prototype.hasOwnProperty.call(patch, "about_html");
  const oldAboutPaths = shouldDiffAbout ? collectCourseAssetPathsFromHtml((currentData as { about_html?: string | null }).about_html ?? null) : new Set<string>();
  const newAboutPaths = shouldDiffAbout ? collectCourseAssetPathsFromHtml((updatePayload.about_html as string | null) ?? null) : new Set<string>();

  const { data: updatedData, error: updateError } = await admin
    .from("courses")
    .update(updatePayload)
    .eq("id", id)
    .select(
      "id, organization_id, title, slug, status, is_published, about_html, excerpt, difficulty_level, what_will_learn, total_duration_hours, total_duration_minutes, materials_included, requirements_instructions, intro_video_provider, intro_video_url, intro_video_storage_path, intro_video_size_bytes, intro_video_mime, cover_image_url, thumbnail_storage_path, builder_version, created_at, updated_at"
    )
    .single();

  if (updateError || !updatedData) {
    const supportId = generateSupportId();
    await logApiEvent({
      request,
      caller,
      outcome: "error",
      status: 500,
      code: "INTERNAL",
      publicMessage: "Failed to update course.",
      internalMessage: updateError?.message,
      details: { support_id: supportId },
    });
    return apiError("INTERNAL", "Failed to update course.", { status: 500, supportId });
  }

  // Best-effort cleanup (delayed): enqueue any removed inline assets from About Course HTML.
  if (shouldDiffAbout) {
    for (const p of oldAboutPaths) {
      if (newAboutPaths.has(p)) continue;
      const rpc = await admin.rpc("enqueue_asset_deletion", {
        p_bucket_id: "course-lesson-assets",
        p_object_name: p,
        p_delay_seconds: 60 * 60 * 2,
        p_requested_by: caller.id,
        p_reason: "removed from course about_html",
      });
      if (rpc.error) {
        // ignore
      }
    }
  }

  await logApiEvent({
    request,
    caller,
    outcome: "success",
    status: 200,
    publicMessage: "Course updated.",
    details: { course_id: id, patch_keys: Object.keys(updatePayload) },
  });

  return apiOk({ course: updatedData }, { status: 200, message: "Course updated." });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { user: caller, error } = await getServerUser();
  if (error || !caller) {
    await logApiEvent({ request, caller: null, outcome: "error", status: 401, code: "UNAUTHORIZED", publicMessage: "Unauthorized" });
    return apiError("UNAUTHORIZED", "Unauthorized", { status: 401 });
  }

  if (caller.role !== "organization_admin" || !caller.organization_id) {
    await logApiEvent({ request, caller, outcome: "error", status: 403, code: "FORBIDDEN", publicMessage: "Forbidden" });
    return apiError("FORBIDDEN", "Forbidden", { status: 403 });
  }

  const admin = createAdminSupabaseClient();
  const { data: courseData, error: courseError } = await admin
    .from("courses")
    .select("id, organization_id, title, about_html, thumbnail_storage_path, intro_video_storage_path")
    .eq("id", id)
    .single();

  if (courseError || !courseData?.id) {
    return apiError("NOT_FOUND", "Course not found.", { status: 404 });
  }
  if (String(courseData.organization_id ?? "") !== caller.organization_id) {
    await logApiEvent({ request, caller, outcome: "error", status: 403, code: "FORBIDDEN", publicMessage: "Forbidden", details: { course_id: id } });
    return apiError("FORBIDDEN", "Forbidden", { status: 403 });
  }

  const { data: certificates, error: certError } = await admin
    .from("certificates")
    .select("id, storage_bucket, storage_path, course_title_snapshot, certificate_title_snapshot")
    .eq("course_id", id);

  if (certError) {
    const supportId = generateSupportId();
    await logApiEvent({
      request,
      caller,
      outcome: "error",
      status: 500,
      code: "INTERNAL",
      publicMessage: "Failed to validate certificates before deleting course.",
      internalMessage: certError.message,
      details: { course_id: id, support_id: supportId },
    });
    return apiError("INTERNAL", "Failed to validate certificates before deleting course.", { status: 500, supportId });
  }

  for (const cert of Array.isArray(certificates) ? certificates : []) {
    const storageBucket = typeof cert.storage_bucket === "string" && cert.storage_bucket.trim().length > 0 ? cert.storage_bucket.trim() : null;
    const storagePath = typeof cert.storage_path === "string" && cert.storage_path.trim().length > 0 ? cert.storage_path.trim() : null;
    let generatedMissingPdf = false;
    if (!storageBucket || !storagePath) {
      const generated = await generateAndPersistCertificatePdf(String(cert.id));
      if (!generated.ok) {
        return apiError(
          "CONFLICT",
          "Course cannot be deleted because one issued certificate could not be preserved. Please try downloading/regenerating certificates first.",
          { status: 409 }
        );
      }
      generatedMissingPdf = true;
    }

    const courseTitleSnapshot =
      typeof cert.course_title_snapshot === "string" && cert.course_title_snapshot.trim().length > 0 ? cert.course_title_snapshot.trim() : null;
    const certificateTitleSnapshot =
      typeof cert.certificate_title_snapshot === "string" && cert.certificate_title_snapshot.trim().length > 0
        ? cert.certificate_title_snapshot.trim()
        : null;
    if (!generatedMissingPdf && (!courseTitleSnapshot || !certificateTitleSnapshot)) {
      return apiError("CONFLICT", "Course cannot be deleted because one issued certificate is missing snapshot data.", { status: 409 });
    }
  }

  const lessonAssetPaths = collectCourseAssetPathsFromHtml((courseData as { about_html?: string | null }).about_html ?? null);
  const courseCoverPaths = new Set<string>();
  const introVideoPaths = new Set<string>();
  const certificateTemplatePaths: Array<{ bucket: string; path: string }> = [];

  const thumbnailPath =
    typeof (courseData as { thumbnail_storage_path?: unknown }).thumbnail_storage_path === "string"
      ? String((courseData as { thumbnail_storage_path: string }).thumbnail_storage_path).trim()
      : "";
  if (thumbnailPath && isSafeStoragePath(thumbnailPath)) courseCoverPaths.add(thumbnailPath);

  const introVideoPath =
    typeof (courseData as { intro_video_storage_path?: unknown }).intro_video_storage_path === "string"
      ? String((courseData as { intro_video_storage_path: string }).intro_video_storage_path).trim()
      : "";
  if (introVideoPath && isSafeStoragePath(introVideoPath)) introVideoPaths.add(introVideoPath);

  const [{ data: itemsData }, { data: templateData }] = await Promise.all([
    admin.from("course_topic_items").select("id, payload_json").eq("course_id", id),
    admin.from("course_certificate_templates").select("storage_bucket, storage_path").eq("course_id", id),
  ]);

  for (const row of Array.isArray(itemsData) ? itemsData : []) {
    collectStoragePathsFromJson((row as { payload_json?: unknown }).payload_json ?? null, lessonAssetPaths);
  }

  for (const row of Array.isArray(templateData) ? templateData : []) {
    const bucket = typeof row.storage_bucket === "string" ? row.storage_bucket.trim() : "";
    const path = typeof row.storage_path === "string" ? row.storage_path.trim() : "";
    if (bucket && bucket !== "certificates" && path && isSafeStoragePath(path)) {
      certificateTemplatePaths.push({ bucket, path });
    }
  }

  const { error: deleteError } = await admin.from("courses").delete().eq("id", id);
  if (deleteError) {
    const supportId = generateSupportId();
    await logApiEvent({
      request,
      caller,
      outcome: "error",
      status: 500,
      code: "INTERNAL",
      publicMessage: "Failed to delete course.",
      internalMessage: deleteError.message,
      details: { course_id: id, support_id: supportId },
    });
    return apiError("INTERNAL", "Failed to delete course.", { status: 500, supportId });
  }

  const cleanupErrors: string[] = [];
  for (const path of courseCoverPaths) {
    const err = await enqueueAssetDeletion({ admin, bucketId: "course-covers", objectName: path, requestedBy: caller.id, reason: "course hard deleted" });
    if (err) cleanupErrors.push(`course-covers/${path}: ${err}`);
  }
  for (const path of introVideoPaths) {
    const err = await enqueueAssetDeletion({ admin, bucketId: "course-intro-videos", objectName: path, requestedBy: caller.id, reason: "course hard deleted" });
    if (err) cleanupErrors.push(`course-intro-videos/${path}: ${err}`);
  }
  for (const path of lessonAssetPaths) {
    const err = await enqueueAssetDeletion({ admin, bucketId: "course-lesson-assets", objectName: path, requestedBy: caller.id, reason: "course hard deleted" });
    if (err) cleanupErrors.push(`course-lesson-assets/${path}: ${err}`);
  }
  for (const item of certificateTemplatePaths) {
    const err = await enqueueAssetDeletion({ admin, bucketId: item.bucket, objectName: item.path, requestedBy: caller.id, reason: "course hard deleted" });
    if (err) cleanupErrors.push(`${item.bucket}/${item.path}: ${err}`);
  }

  await logApiEvent({
    request,
    caller,
    outcome: "success",
    status: 200,
    publicMessage: "Course deleted.",
    details: {
      course_id: id,
      preserved_certificates_count: Array.isArray(certificates) ? certificates.length : 0,
      cleanup_error_count: cleanupErrors.length,
    },
  });

  return apiOk(
    {
      course_id: id,
      preserved_certificates_count: Array.isArray(certificates) ? certificates.length : 0,
      cleanup_error_count: cleanupErrors.length,
    },
    { status: 200, message: "Course deleted." }
  );
}

