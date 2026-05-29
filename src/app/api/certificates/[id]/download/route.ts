import { NextRequest, NextResponse } from "next/server";

import { apiError } from "@/lib/api/response";
import { logApiEvent } from "@/lib/audit/apiEvents";
import { createAdminSupabaseClient, getServerUser } from "@/lib/supabase/server";
import { generateAndPersistCertificatePdf } from "@/lib/certificates/generateCertificatePdf";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: certificateId } = await context.params;
  const { user: caller, error } = await getServerUser();
  if (error || !caller) {
    await logApiEvent({ request, caller: null, outcome: "error", status: 401, code: "UNAUTHORIZED", publicMessage: "Unauthorized" });
    return apiError("UNAUTHORIZED", "Unauthorized", { status: 401 });
  }

  const admin = createAdminSupabaseClient();

  // Load certificate record
  const { data: cert, error: certErr } = await admin
    .from("certificates")
    .select("id, organization_id, user_id, course_id, status, issued_at, storage_bucket, storage_path, file_name, mime_type, size_bytes, generated_at, template_id, course_score_percent")
    .eq("id", certificateId)
    .maybeSingle();

  if (certErr) return apiError("INTERNAL", "Failed to load certificate.", { status: 500 });
  if (!cert?.id) return apiError("NOT_FOUND", "Certificate not found.", { status: 404 });

  // Permission checks (server-side; do not rely on client filtering)
  if (caller.role === "member") {
    if (String((cert as { user_id?: unknown }).user_id ?? "") !== String(caller.id)) return apiError("FORBIDDEN", "Forbidden", { status: 403 });
  } else if (caller.role === "organization_admin") {
    if (!caller.organization_id) return apiError("FORBIDDEN", "Forbidden", { status: 403 });
    if (String((cert as { organization_id?: unknown }).organization_id ?? "") !== String(caller.organization_id)) return apiError("FORBIDDEN", "Forbidden", { status: 403 });
  } else if (!["super_admin", "system_admin"].includes(caller.role)) {
    return apiError("FORBIDDEN", "Forbidden", { status: 403 });
  }

  const storage_bucket = typeof (cert as { storage_bucket?: unknown }).storage_bucket === "string" ? String((cert as { storage_bucket: string }).storage_bucket) : null;
  const storage_path = typeof (cert as { storage_path?: unknown }).storage_path === "string" ? String((cert as { storage_path: string }).storage_path) : null;

  // If already generated, redirect to signed URL
  if (storage_bucket && storage_path) {
    const { data: signed, error: signedErr } = await admin.storage.from(storage_bucket).createSignedUrl(storage_path, 60 * 10);
    if (signedErr || !signed?.signedUrl) return apiError("INTERNAL", "Failed to create download URL.", { status: 500 });
    return NextResponse.redirect(signed.signedUrl, { status: 302 });
  }

  const generated = await generateAndPersistCertificatePdf(certificateId);
  if (!generated.ok) return apiError(generated.code, generated.message, { status: generated.status });

  const { data: signed2, error: signedErr2 } = await admin.storage.from(generated.bucket).createSignedUrl(generated.path, 60 * 10);
  if (signedErr2 || !signed2?.signedUrl) return apiError("INTERNAL", "Failed to create download URL.", { status: 500 });

  return NextResponse.redirect(signed2.signedUrl, { status: 302 });
}

