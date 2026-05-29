import { NextRequest, NextResponse } from "next/server";

import { createAdminSupabaseClient, getServerUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

type CertificateRow = {
  id: string;
  organization_id?: string | null;
  user_id?: string | null;
  course_id?: string | null;
  issued_at?: string | null;
  created_at?: string | null;
  status?: string | null;
  expires_at?: string | null;
  source_attempt_id?: string | null;
  course_title_snapshot?: string | null;
  organization_name_snapshot?: string | null;
  organization_slug_snapshot?: string | null;
  user_full_name_snapshot?: string | null;
  user_email_snapshot?: string | null;
};

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  const escaped = s.replace(/"/g, '""');
  return `"${escaped}"`;
}

function buildCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "No data\n";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(",")),
  ];
  return lines.join("\n") + "\n";
}

function parseIntParam(v: string | null, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export async function GET(request: NextRequest) {
  const { user, error } = await getServerUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "member") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (user.role === "system_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const orgIdParam = url.searchParams.get("orgId");
  const max = Math.min(parseIntParam(url.searchParams.get("max"), 50000), 50000);

  // Permission enforcement
  let effectiveOrgId: string | null = orgIdParam;
  if (user.role === "organization_admin") {
    if (!user.organization_id) return NextResponse.json({ error: "Missing organization" }, { status: 400 });
    if (orgIdParam && orgIdParam !== user.organization_id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    effectiveOrgId = user.organization_id;
  }

  const admin = createAdminSupabaseClient();

  // Rate limit: 2 exports per 30 minutes per user per export type
  try {
    const windowStartIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { count, error: rateErr } = await admin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("actor_user_id", user.id)
      .eq("action", "export_certificates")
      .gte("created_at", windowStartIso);
    if (!rateErr && typeof count === "number" && count >= 2) {
      return NextResponse.json(
        { error: "Rate limit: you can export Certificates (CSV) up to 2 times per 30 minutes." },
        { status: 429 }
      );
    }
  } catch {
    // ignore rate limit failures (do not block exports)
  }

  let q = admin
    .from("certificates")
    .select("id, organization_id, user_id, course_id, issued_at, created_at, status, expires_at, source_attempt_id, course_title_snapshot, organization_name_snapshot, organization_slug_snapshot, user_full_name_snapshot, user_email_snapshot")
    .order("created_at", { ascending: false })
    .range(0, Math.max(0, max - 1));

  if (effectiveOrgId && effectiveOrgId.length > 0) {
    q = q.eq("organization_id", effectiveOrgId);
  }

  const { data, error: loadError } = await q;
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });

  const certs = (Array.isArray(data) ? data : []) as CertificateRow[];

  // Hydrate org/user/course labels (small, capped by max)
  const orgIds = Array.from(new Set(certs.map((c) => c.organization_id).filter((v): v is string => typeof v === "string" && v.length > 0)));
  const userIds = Array.from(new Set(certs.map((c) => c.user_id).filter((v): v is string => typeof v === "string" && v.length > 0)));
  const courseIds = Array.from(new Set(certs.map((c) => c.course_id).filter((v): v is string => typeof v === "string" && v.length > 0)));

  const [{ data: orgsData }, { data: usersData }, { data: coursesData }] = await Promise.all([
    orgIds.length > 0 ? admin.from("organizations").select("id, name, slug").in("id", orgIds) : Promise.resolve({ data: [] }),
    userIds.length > 0 ? admin.from("users").select("id, full_name, email").in("id", userIds) : Promise.resolve({ data: [] }),
    courseIds.length > 0 ? admin.from("courses").select("id, title").in("id", courseIds) : Promise.resolve({ data: [] }),
  ]);

  const orgLabelById = new Map<string, string>();
  for (const o of (Array.isArray(orgsData) ? orgsData : []) as Array<{ id?: unknown; name?: unknown; slug?: unknown }>) {
    const id = typeof o.id === "string" ? o.id : null;
    if (!id) continue;
    const name = typeof o.name === "string" && o.name.trim().length ? o.name.trim() : null;
    const slug = typeof o.slug === "string" && o.slug.trim().length ? o.slug.trim() : null;
    orgLabelById.set(id, name ?? slug ?? id);
  }

  const userLabelById = new Map<string, string>();
  for (const u of (Array.isArray(usersData) ? usersData : []) as Array<{ id?: unknown; full_name?: unknown; email?: unknown }>) {
    const id = typeof u.id === "string" ? u.id : null;
    if (!id) continue;
    const fullName = typeof u.full_name === "string" && u.full_name.trim().length ? u.full_name.trim() : null;
    const email = typeof u.email === "string" && u.email.trim().length ? u.email.trim() : null;
    userLabelById.set(id, fullName ?? email ?? id);
  }

  const courseTitleById = new Map<string, string>();
  for (const c of (Array.isArray(coursesData) ? coursesData : []) as Array<{ id?: unknown; title?: unknown }>) {
    const id = typeof c.id === "string" ? c.id : null;
    if (!id) continue;
    const title = typeof c.title === "string" && c.title.trim().length ? c.title.trim() : null;
    courseTitleById.set(id, title ?? "Untitled course");
  }

  const exportRows = certs.map((c) => ({
    organization_id: c.organization_id ?? "",
    organization_name: c.organization_id
      ? (orgLabelById.get(c.organization_id) ?? c.organization_name_snapshot ?? c.organization_slug_snapshot ?? "")
      : (c.organization_name_snapshot ?? c.organization_slug_snapshot ?? ""),
    certificate_id: c.id,
    user_id: c.user_id ?? "",
    user: c.user_id
      ? (userLabelById.get(c.user_id) ?? c.user_full_name_snapshot ?? c.user_email_snapshot ?? "")
      : (c.user_full_name_snapshot ?? c.user_email_snapshot ?? ""),
    course_id: c.course_id ?? "",
    course_title: c.course_id ? (courseTitleById.get(c.course_id) ?? c.course_title_snapshot ?? "") : (c.course_title_snapshot ?? ""),
    status: c.status ?? "",
    issued_at: c.issued_at ?? c.created_at ?? "",
    expires_at: c.expires_at ?? "",
    source_attempt_id: c.source_attempt_id ?? "",
  }));

  const csv = buildCsv(exportRows);
  const filename = effectiveOrgId ? `certificates-${effectiveOrgId}.csv` : "certificates-all.csv";

  // Best-effort audit log (do not block exports)
  try {
    await admin.from("audit_logs").insert({
      actor_user_id: user.id,
      actor_email: user.email,
      actor_role: user.role,
      action: "export_certificates",
      entity: effectiveOrgId ? "organizations" : "system",
      entity_id: effectiveOrgId,
      metadata: {
        organization_id: effectiveOrgId ?? null,
        export: "certificates",
        format: "csv",
        row_count: exportRows.length,
        max,
      },
    });
  } catch {
    // ignore
  }

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

