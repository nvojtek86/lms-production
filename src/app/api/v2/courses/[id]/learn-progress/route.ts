import { NextRequest } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient, getServerUser } from "@/lib/supabase/server";
import { apiError, apiOk } from "@/lib/api/response";
import { logApiEvent } from "@/lib/audit/apiEvents";

export const runtime = "nodejs";

const upsertSchema = z.object({
  item_id: z.string().uuid(),
});

async function isPublishedCourseForOrg(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  courseId: string,
  organizationId: string
): Promise<boolean> {
  const { data: course } = await supabase
    .from("courses")
    .select("id, organization_id, is_published")
    .eq("id", courseId)
    .maybeSingle();

  return Boolean(
    course?.id &&
      String((course as { organization_id?: unknown }).organization_id ?? "") === organizationId &&
      (course as { is_published?: unknown }).is_published === true
  );
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: courseId } = await context.params;
  const { user: caller, error } = await getServerUser();
  if (error || !caller) {
    await logApiEvent({ request, caller: null, outcome: "error", status: 401, code: "UNAUTHORIZED", publicMessage: "Unauthorized" });
    return apiError("UNAUTHORIZED", "Unauthorized", { status: 401 });
  }
  if (caller.role !== "member" || !caller.organization_id) {
    await logApiEvent({ request, caller, outcome: "error", status: 403, code: "FORBIDDEN", publicMessage: "Forbidden" });
    return apiError("FORBIDDEN", "Forbidden", { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const canAccessCourse = await isPublishedCourseForOrg(supabase, courseId, caller.organization_id);
  if (!canAccessCourse) return apiError("FORBIDDEN", "This course is not published.", { status: 403 });

  const [{ data: resume }, { data: visits }] = await Promise.all([
    supabase
      .from("course_v2_resume_state")
      .select("last_item_id")
      .eq("course_id", courseId)
      .eq("user_id", caller.id)
      .maybeSingle(),
    supabase
      .from("course_v2_item_visits")
      .select("item_id")
      .eq("course_id", courseId)
      .eq("user_id", caller.id),
  ]);

  const last_item_id = resume && typeof (resume as { last_item_id?: unknown }).last_item_id === "string" ? (resume as { last_item_id: string }).last_item_id : null;
  const visited_item_ids = (Array.isArray(visits) ? visits : [])
    .map((r) => (r as { item_id?: unknown }).item_id)
    .filter((v): v is string => typeof v === "string");

  return apiOk({ last_item_id, visited_item_ids }, { status: 200 });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: courseId } = await context.params;
  const { user: caller, error } = await getServerUser();
  if (error || !caller) {
    await logApiEvent({ request, caller: null, outcome: "error", status: 401, code: "UNAUTHORIZED", publicMessage: "Unauthorized" });
    return apiError("UNAUTHORIZED", "Unauthorized", { status: 401 });
  }
  if (caller.role !== "member" || !caller.organization_id) {
    await logApiEvent({ request, caller, outcome: "error", status: 403, code: "FORBIDDEN", publicMessage: "Forbidden" });
    return apiError("FORBIDDEN", "Forbidden", { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    await logApiEvent({ request, caller, outcome: "error", status: 400, code: "VALIDATION_ERROR", publicMessage: "Invalid request." });
    return apiError("VALIDATION_ERROR", "Invalid request.", { status: 400 });
  }

  const { item_id } = parsed.data;
  const supabase = await createServerSupabaseClient();
  const canAccessCourse = await isPublishedCourseForOrg(supabase, courseId, caller.organization_id);
  if (!canAccessCourse) return apiError("FORBIDDEN", "This course is not published.", { status: 403 });

  // Validate that the item belongs to this course (defense in depth; FK does not enforce this relation).
  const { data: itemRow, error: itemError } = await supabase
    .from("course_topic_items")
    .select("id, course_id, organization_id")
    .eq("id", item_id)
    .maybeSingle();
  if (itemError || !itemRow?.id) return apiError("NOT_FOUND", "Item not found.", { status: 404 });
  if (String((itemRow as { course_id?: unknown }).course_id ?? "") !== String(courseId)) return apiError("VALIDATION_ERROR", "Invalid item.", { status: 400 });
  if (String((itemRow as { organization_id?: unknown }).organization_id ?? "") !== String(caller.organization_id)) return apiError("FORBIDDEN", "Forbidden", { status: 403 });

  const now = new Date().toISOString();

  // RLS enforces: own rows + active enrollment.
  const [{ error: visitsError }, { error: resumeError }] = await Promise.all([
    supabase
      .from("course_v2_item_visits")
      .upsert(
        {
          organization_id: caller.organization_id,
          course_id: courseId,
          user_id: caller.id,
          item_id,
          visited_at: now,
        },
        { onConflict: "user_id,course_id,item_id" }
      ),
    supabase
      .from("course_v2_resume_state")
      .upsert(
        {
          organization_id: caller.organization_id,
          course_id: courseId,
          user_id: caller.id,
          last_item_id: item_id,
        },
        { onConflict: "user_id,course_id" }
      ),
  ]);

  if (visitsError || resumeError) {
    await logApiEvent({
      request,
      caller,
      outcome: "error",
      status: 400,
      code: "VALIDATION_ERROR",
      publicMessage: "Failed to persist progress.",
      internalMessage: visitsError?.message || resumeError?.message,
    });
    return apiError("VALIDATION_ERROR", "Failed to persist progress.", { status: 400 });
  }

  return apiOk({ ok: true }, { status: 200 });
}

