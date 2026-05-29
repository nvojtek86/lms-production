import { NextRequest } from "next/server";
import { createAdminSupabaseClient, getServerUser } from "@/lib/supabase/server";
import { apiError, apiOk } from "@/lib/api/response";

export const runtime = "nodejs";

async function ensureLessonAssetsBucket(admin: ReturnType<typeof createAdminSupabaseClient>) {
  const bucketId = "course-lesson-assets";
  const { data, error } = await admin.storage.getBucket(bucketId);
  if (!error && data?.id) return;
  const create = await admin.storage.createBucket(bucketId, { public: false });
  if (create.error) {
    console.error("[lesson-assets] bucket ensure failed", create.error);
  }
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120) || "attachment";
}

export async function POST(request: NextRequest, context: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await context.params;
  const { user: caller, error } = await getServerUser();
  if (error || !caller) return apiError("UNAUTHORIZED", "Unauthorized", { status: 401 });
  if (caller.role !== "organization_admin" || !caller.organization_id) return apiError("FORBIDDEN", "Forbidden", { status: 403 });

  const form = await request.formData().catch(() => null);
  if (!form) return apiError("VALIDATION_ERROR", "Invalid form data.", { status: 400 });
  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  if (!files.length) return apiError("VALIDATION_ERROR", "No files uploaded.", { status: 400 });

  const maxBytesPerFile = 300 * 1024 * 1024; // 300MB
  for (const f of files) {
    if (f.size > maxBytesPerFile) return apiError("VALIDATION_ERROR", `File too large: ${f.name} (max 300MB).`, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  await ensureLessonAssetsBucket(admin);
  const { data: item, error: itemError } = await admin
    .from("course_topic_items")
    .select("id, organization_id, course_id")
    .eq("id", itemId)
    .single();
  if (itemError || !item?.id) return apiError("NOT_FOUND", "Item not found.", { status: 404 });
  if (item.organization_id !== caller.organization_id) return apiError("FORBIDDEN", "Forbidden", { status: 403 });

  const uploaded: Array<{ file_name: string; storage_path: string; size_bytes: number; mime: string | null }> = [];
  for (const f of files) {
    const ts = Date.now();
    const name = safeFileName(f.name);
    const path = `${caller.organization_id}/${item.course_id}/${itemId}/attachments/${ts}-${name}`;
    const bytes = Buffer.from(await f.arrayBuffer());
    const res = await admin.storage.from("course-lesson-assets").upload(path, bytes, {
      contentType: f.type || "application/octet-stream",
      upsert: true,
    });
    if (res.error) {
      console.error("[lesson attachment upload]", {
        bucket: "course-lesson-assets",
        path,
        itemId,
        orgId: caller.organization_id,
        courseId: item.course_id,
        fileName: f.name,
        error: res.error,
      });
      const msg =
        process.env.NODE_ENV === "production" ? "Attachment upload failed." : `Attachment upload failed: ${res.error.message}`;
      return apiError("INTERNAL", msg, { status: 500 });
    }
    uploaded.push({ file_name: f.name, storage_path: path, size_bytes: f.size, mime: f.type || null });
  }

  return apiOk({ attachments: uploaded }, { status: 200, message: "Attachments uploaded." });
}

