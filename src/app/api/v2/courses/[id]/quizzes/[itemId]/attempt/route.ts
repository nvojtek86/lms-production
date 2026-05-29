import { NextRequest } from "next/server";
import { z } from "zod";

import { apiError, apiOk } from "@/lib/api/response";
import { logApiEvent } from "@/lib/audit/apiEvents";
import { createAdminSupabaseClient, createServerSupabaseClient, getServerUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

const postSchema = z.object({
  action: z.enum(["start", "autosave", "retake"]),
  answers_json: z.record(z.string(), z.unknown()).optional(),
});

type AttemptRow = {
  id: string;
  attempt_number: number;
  status: string;
  started_at: string;
  submitted_at: string | null;
  answers_json: Record<string, unknown>;
};

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

async function loadQuizSettings(input: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  courseId: string;
  itemId: string;
}) {
  const { data: item, error } = await input.supabase
    .from("course_topic_items")
    .select("id, course_id, organization_id, item_type, payload_json")
    .eq("id", input.itemId)
    .maybeSingle();
  if (error || !item?.id) return { ok: false as const, status: 404, code: "NOT_FOUND" as const, msg: "Quiz not found." };
  if (String((item as { course_id?: unknown }).course_id ?? "") !== String(input.courseId)) {
    return { ok: false as const, status: 400, code: "VALIDATION_ERROR" as const, msg: "Invalid quiz." };
  }
  if (String((item as { item_type?: unknown }).item_type ?? "") !== "quiz") {
    return { ok: false as const, status: 400, code: "VALIDATION_ERROR" as const, msg: "Invalid quiz." };
  }

  const payload = (item as { payload_json?: unknown }).payload_json;
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const settings = p.settings && typeof p.settings === "object" ? (p.settings as Record<string, unknown>) : {};
  const attempts_allowed = Number.isFinite(Number(settings.attempts_allowed)) ? Math.max(0, Math.floor(Number(settings.attempts_allowed))) : 0;

  return {
    ok: true as const,
    item: item as { id: string; organization_id: string },
    attempts_allowed,
  };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string; itemId: string }> }) {
  const { id: courseId, itemId } = await context.params;
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

  // Ensure enrolled (RLS allows member read own enrollment).
  const { data: enrollment } = await supabase
    .from("course_enrollments")
    .select("id, status")
    .eq("course_id", courseId)
    .eq("user_id", caller.id)
    .maybeSingle();
  if (!enrollment?.id || enrollment.status !== "active") return apiError("FORBIDDEN", "Forbidden", { status: 403 });

  const quizSettings = await loadQuizSettings({ supabase, courseId, itemId });
  if (!quizSettings.ok) return apiError(quizSettings.code, quizSettings.msg, { status: quizSettings.status });
  if (quizSettings.item.organization_id !== caller.organization_id) return apiError("FORBIDDEN", "Forbidden", { status: 403 });

  const [{ data: active }, { data: state }, { count: submittedCount }] = await Promise.all([
    supabase
      .from("course_v2_quiz_attempts")
      .select("id, attempt_number, status, started_at, submitted_at, answers_json")
      .eq("course_id", courseId)
      .eq("item_id", itemId)
      .eq("user_id", caller.id)
      .eq("status", "in_progress")
      .maybeSingle(),
    supabase
      .from("course_v2_quiz_state")
      .select("best_score_percent, passed_at, last_attempt_id, last_submitted_attempt_id")
      .eq("course_id", courseId)
      .eq("item_id", itemId)
      .eq("user_id", caller.id)
      .maybeSingle(),
    supabase
      .from("course_v2_quiz_attempts")
      .select("id", { count: "exact", head: true })
      .eq("course_id", courseId)
      .eq("item_id", itemId)
      .eq("user_id", caller.id)
      .eq("status", "submitted"),
  ]);

  const attempt = active ? (active as AttemptRow) : null;
  const submitted_attempts_count = typeof submittedCount === "number" ? submittedCount : 0;

  return apiOk(
    {
      attempts_allowed: quizSettings.attempts_allowed,
      submitted_attempts_count,
      attempt,
      state: state
        ? {
            best_score_percent:
              Number.isFinite(Number((state as { best_score_percent?: unknown }).best_score_percent))
                ? Number((state as { best_score_percent: number }).best_score_percent)
                : null,
            passed_at: typeof (state as { passed_at?: unknown }).passed_at === "string" ? String((state as { passed_at: string }).passed_at) : null,
            last_attempt_id: typeof (state as { last_attempt_id?: unknown }).last_attempt_id === "string" ? String((state as { last_attempt_id: string }).last_attempt_id) : null,
            last_submitted_attempt_id:
              typeof (state as { last_submitted_attempt_id?: unknown }).last_submitted_attempt_id === "string"
                ? String((state as { last_submitted_attempt_id: string }).last_submitted_attempt_id)
                : null,
          }
        : null,
    },
    { status: 200 }
  );
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string; itemId: string }> }) {
  const { id: courseId, itemId } = await context.params;
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
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    await logApiEvent({ request, caller, outcome: "error", status: 400, code: "VALIDATION_ERROR", publicMessage: "Invalid request." });
    return apiError("VALIDATION_ERROR", "Invalid request.", { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const canAccessCourse = await isPublishedCourseForOrg(supabase, courseId, caller.organization_id);
  if (!canAccessCourse) return apiError("FORBIDDEN", "This course is not published.", { status: 403 });

  const { data: enrollment } = await supabase
    .from("course_enrollments")
    .select("id, status")
    .eq("course_id", courseId)
    .eq("user_id", caller.id)
    .maybeSingle();
  if (!enrollment?.id || enrollment.status !== "active") return apiError("FORBIDDEN", "Forbidden", { status: 403 });

  const quizSettings = await loadQuizSettings({ supabase, courseId, itemId });
  if (!quizSettings.ok) return apiError(quizSettings.code, quizSettings.msg, { status: quizSettings.status });
  if (quizSettings.item.organization_id !== caller.organization_id) return apiError("FORBIDDEN", "Forbidden", { status: 403 });

  const action = parsed.data.action;
  const answers_json = parsed.data.answers_json ?? undefined;

  // Load current active attempt (if any).
  const { data: activeAttempt } = await supabase
    .from("course_v2_quiz_attempts")
    .select("id, attempt_number, status, started_at, submitted_at, answers_json")
    .eq("course_id", courseId)
    .eq("item_id", itemId)
    .eq("user_id", caller.id)
    .eq("status", "in_progress")
    .maybeSingle();

  if (action === "autosave") {
    if (!answers_json || typeof answers_json !== "object") return apiError("VALIDATION_ERROR", "Missing answers.", { status: 400 });
    if (!activeAttempt?.id) return apiError("CONFLICT", "No active attempt.", { status: 409 });
    const { error: updateError } = await supabase
      .from("course_v2_quiz_attempts")
      .update({ answers_json })
      .eq("id", String((activeAttempt as { id: string }).id));
    if (updateError) return apiError("INTERNAL", "Failed to save answers.", { status: 500 });
    return apiOk({ ok: true }, { status: 200 });
  }

  // For start/retake, enforce attempts limit (unless unlimited).
  if (quizSettings.attempts_allowed > 0) {
    const { count } = await supabase
      .from("course_v2_quiz_attempts")
      .select("id", { count: "exact", head: true })
      .eq("course_id", courseId)
      .eq("item_id", itemId)
      .eq("user_id", caller.id)
      .eq("status", "submitted");
    const submitted = typeof count === "number" ? count : 0;
    if (submitted >= quizSettings.attempts_allowed) {
      return apiError("CONFLICT", "Attempts limit reached.", { status: 409 });
    }
  }

  if (action === "start") {
    if (activeAttempt?.id) {
      return apiOk({ attempt: activeAttempt as AttemptRow }, { status: 200 });
    }
  }

  if (action === "retake" && activeAttempt?.id) {
    // Mark existing active attempt as abandoned (best-effort).
    await supabase.from("course_v2_quiz_attempts").update({ status: "abandoned" }).eq("id", String((activeAttempt as { id: string }).id));
  }

  // Compute next attempt number.
  const { data: lastAttemptRow } = await supabase
    .from("course_v2_quiz_attempts")
    .select("attempt_number")
    .eq("course_id", courseId)
    .eq("item_id", itemId)
    .eq("user_id", caller.id)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastNum = lastAttemptRow && Number.isFinite(Number((lastAttemptRow as { attempt_number?: unknown }).attempt_number)) ? Number((lastAttemptRow as { attempt_number: number }).attempt_number) : 0;
  const attempt_number = Math.max(1, lastNum + 1);

  const now = new Date().toISOString();
  const { data: created, error: createError } = await supabase
    .from("course_v2_quiz_attempts")
    .insert({
      organization_id: caller.organization_id,
      course_id: courseId,
      user_id: caller.id,
      item_id: itemId,
      attempt_number,
      status: "in_progress",
      started_at: now,
      answers_json: answers_json && typeof answers_json === "object" ? answers_json : {},
    })
    .select("id, attempt_number, status, started_at, submitted_at, answers_json")
    .single();

  if (createError || !created?.id) {
    // If a concurrent request created the active attempt, return it.
    const { data: fallback } = await supabase
      .from("course_v2_quiz_attempts")
      .select("id, attempt_number, status, started_at, submitted_at, answers_json")
      .eq("course_id", courseId)
      .eq("item_id", itemId)
      .eq("user_id", caller.id)
      .eq("status", "in_progress")
      .maybeSingle();
    if (fallback?.id) return apiOk({ attempt: fallback as AttemptRow }, { status: 200 });

    await logApiEvent({
      request,
      caller,
      outcome: "error",
      status: 500,
      code: "INTERNAL",
      publicMessage: "Failed to start attempt.",
      internalMessage: createError?.message,
    });
    return apiError("INTERNAL", "Failed to start attempt.", { status: 500 });
  }

  // Update quiz_state.last_attempt_id for convenience (admin write).
  try {
    const admin = createAdminSupabaseClient();
    await admin
      .from("course_v2_quiz_state")
      .upsert(
        {
          organization_id: caller.organization_id,
          course_id: courseId,
          user_id: caller.id,
          item_id: itemId,
          last_attempt_id: (created as { id: string }).id,
        },
        { onConflict: "user_id,course_id,item_id" }
      );
  } catch {
    // ignore
  }

  return apiOk({ attempt: created as AttemptRow }, { status: 200 });
}

