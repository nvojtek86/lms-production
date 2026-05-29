import { NextRequest } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient, getServerUser } from "@/lib/supabase/server";
import { apiError, apiOk } from "@/lib/api/response";
import { logApiEvent } from "@/lib/audit/apiEvents";
import { generateSupportId } from "@/lib/support/supportId";

export const runtime = "nodejs";

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120) || "attachment";
}

const signSchema = z.object({
  files: z
    .array(
      z.object({
        file_name: z.string().min(1).max(300),
        mime: z.string().nullable().optional(),
        size_bytes: z.number().int().positive().max(300 * 1024 * 1024),
      })
    )
    .min(1),
});

export async function POST(request: NextRequest, context: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await context.params;
  const { user: caller, error } = await getServerUser();
  if (error || !caller) return apiError("UNAUTHORIZED", "Unauthorized", { status: 401 });
  if (caller.role !== "organization_admin" || !caller.organization_id) return apiError("FORBIDDEN", "Forbidden", { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = signSchema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Invalid request.", { status: 400 });

  const admin = createAdminSupabaseClient();
  const { data: item, error: itemError } = await admin
    .from("course_topic_items")
    .select("id, organization_id, course_id")
    .eq("id", itemId)
    .single();
  if (itemError || !item?.id) return apiError("NOT_FOUND", "Item not found.", { status: 404 });
  if (String(item.organization_id ?? "") !== String(caller.organization_id)) return apiError("FORBIDDEN", "Forbidden", { status: 403 });

  const ts = Date.now();
  const uploads: Array<{ file_name: string; mime: string | null; size_bytes: number; object_name: string; token: string }> = [];

  for (let i = 0; i < parsed.data.files.length; i++) {
    const f = parsed.data.files[i];
    const name = safeFileName(f.file_name);
    const object_name = `${caller.organization_id}/${item.course_id}/${itemId}/attachments/${ts}-${i + 1}-${name}`;
    const { data: signed, error: signedError } = await admin.storage.from("course-lesson-assets").createSignedUploadUrl(object_name);
    if (signedError || !signed?.token) {
      const supportId = generateSupportId();
      await logApiEvent({
        request,
        caller,
        outcome: "error",
        status: 500,
        code: "INTERNAL",
        publicMessage: "Failed to create signed upload URL.",
        internalMessage: signedError?.message,
        details: { item_id: itemId, file_name: f.file_name, support_id: supportId },
      });
      return apiError("INTERNAL", "Failed to create signed upload URL.", { status: 500, supportId });
    }
    uploads.push({
      file_name: f.file_name,
      mime: typeof f.mime === "string" && f.mime.trim().length ? f.mime : null,
      size_bytes: f.size_bytes,
      object_name,
      token: signed.token,
    });
  }

  return apiOk({ bucket_id: "course-lesson-assets", uploads }, { status: 200 });
}

