import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logApiEvent } from "@/lib/audit/apiEvents";
import { createAdminSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const bodySchema = z.object({
  flow: z.enum(["invite", "recovery", "email", "unknown"]),
  stage: z.enum(["redirect", "verify_otp", "code_exchange", "session"]),
  error_code: z.string().trim().min(1).max(80).regex(/^[a-z0-9_-]+$/i),
});

function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded?.trim()) return forwarded.split(",")[0]?.trim() || null;
  return request.headers.get("x-real-ip")?.trim() || null;
}

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ success: false }, { status: 400 });

  // Keep a broken or abused public endpoint from flooding the audit table.
  // This is intentionally best-effort: logging must never affect the recovery UI.
  try {
    const ip = getClientIp(request);
    if (ip) {
      const admin = createAdminSupabaseClient();
      const windowStart = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { count, error } = await admin
        .from("unauth_api_events")
        .select("id", { count: "exact", head: true })
        .eq("path", "/api/auth/link-error")
        .eq("ip", ip)
        .gte("created_at", windowStart);

      if (!error && typeof count === "number" && count >= 10) {
        return NextResponse.json({ success: true }, { status: 202 });
      }
    }
  } catch {
    // Ignore rate-limit lookup failures and attempt the single safe log entry.
  }

  await logApiEvent({
    request,
    caller: null,
    outcome: "error",
    status: 400,
    code: parsed.data.error_code,
    publicMessage: "Authentication link could not be verified.",
    details: {
      flow: parsed.data.flow,
      stage: parsed.data.stage,
    },
  });

  return NextResponse.json({ success: true }, { status: 202 });
}
