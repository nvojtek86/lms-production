import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { createAdminSupabaseClient } from "@/lib/supabase/server";

type Placement = {
  page: number;
  xPct: number;
  yPct: number;
  wPct?: number;
  hPct?: number;
  fontSize?: number;
  fontFamily?: "helvetica" | "helvetica_bold" | "times" | "times_bold" | "courier" | "courier_bold";
  color?: string;
  align?: "left" | "center" | "right";
};

type GenerateCertificatePdfResult =
  | {
      ok: true;
      bucket: string;
      path: string;
      fileName: string | null;
      generated: boolean;
    }
  | {
      ok: false;
      status: number;
      code: "NOT_FOUND" | "CONFLICT" | "VALIDATION_ERROR" | "INTERNAL";
      message: string;
    };

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function parseHexColor(hex: string | undefined): { r: number; g: number; b: number } | null {
  if (!hex) return null;
  const s = hex.trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (!m) return null;
  const v = m[1];
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return { r: r / 255, g: g / 255, b: b / 255 };
}

function safeFilename(base: string) {
  const s = base.trim().replace(/\s+/g, " ");
  const cleaned = s.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-");
  return cleaned.slice(0, 120) || "certificate";
}

function pickStandardFontName(family: Placement["fontFamily"] | undefined): StandardFonts {
  if (family === "helvetica") return StandardFonts.Helvetica;
  if (family === "times") return StandardFonts.TimesRoman;
  if (family === "times_bold") return StandardFonts.TimesRomanBold;
  if (family === "courier") return StandardFonts.Courier;
  if (family === "courier_bold") return StandardFonts.CourierBold;
  return StandardFonts.HelveticaBold;
}

function fitFontSizeToWidth(args: {
  font: { widthOfTextAtSize: (text: string, size: number) => number };
  text: string;
  desired: number;
  maxWidth: number | null;
}): number {
  const desired = Math.max(6, Math.min(200, args.desired));
  if (!args.maxWidth || args.maxWidth <= 0) return desired;
  let s = desired;
  for (let i = 0; i < 60; i++) {
    const w = args.font.widthOfTextAtSize(args.text, s);
    if (w <= args.maxWidth || s <= 6) break;
    s = Math.max(6, s - 1);
  }
  return s;
}

function readString(row: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = row?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export async function generateAndPersistCertificatePdf(certificateId: string): Promise<GenerateCertificatePdfResult> {
  const admin = createAdminSupabaseClient();

  const { data: cert, error: certErr } = await admin
    .from("certificates")
    .select(
      "id, organization_id, user_id, course_id, storage_bucket, storage_path, course_title_snapshot, organization_name_snapshot, organization_slug_snapshot, user_full_name_snapshot, user_email_snapshot, certificate_title_snapshot"
    )
    .eq("id", certificateId)
    .maybeSingle();

  if (certErr) return { ok: false, status: 500, code: "INTERNAL", message: "Failed to load certificate." };
  if (!cert?.id) return { ok: false, status: 404, code: "NOT_FOUND", message: "Certificate not found." };

  const existingBucket = readString(cert as Record<string, unknown>, "storage_bucket");
  const existingPath = readString(cert as Record<string, unknown>, "storage_path");
  if (existingBucket && existingPath) {
    return {
      ok: true,
      bucket: existingBucket,
      path: existingPath,
      fileName: readString(cert as Record<string, unknown>, "file_name"),
      generated: false,
    };
  }

  const courseId = readString(cert as Record<string, unknown>, "course_id");
  const userId = readString(cert as Record<string, unknown>, "user_id");
  const orgId = readString(cert as Record<string, unknown>, "organization_id");
  if (!courseId || !userId || !orgId) {
    return { ok: false, status: 409, code: "CONFLICT", message: "Generated certificate file is missing." };
  }

  const [{ data: tpl }, { data: settings }, { data: userRow }, { data: courseRow }, { data: orgRow }] = await Promise.all([
    admin
      .from("course_certificate_templates")
      .select("id, storage_bucket, storage_path, file_name, mime_type")
      .eq("course_id", courseId)
      .maybeSingle(),
    admin
      .from("course_certificate_settings")
      .select("certificate_title, course_passing_grade_percent, name_placement_json")
      .eq("course_id", courseId)
      .maybeSingle(),
    admin.from("users").select("id, full_name, email").eq("id", userId).maybeSingle(),
    admin.from("courses").select("id, title").eq("id", courseId).maybeSingle(),
    admin.from("organizations").select("id, name, slug").eq("id", orgId).maybeSingle(),
  ]);

  if (!tpl?.storage_bucket || !tpl.storage_path) {
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Certificate template not found." };
  }

  const threshold =
    settings && Number.isFinite(Number((settings as { course_passing_grade_percent?: unknown }).course_passing_grade_percent))
      ? Math.max(0, Math.min(100, Math.floor(Number((settings as { course_passing_grade_percent: number }).course_passing_grade_percent))))
      : 0;
  if (!(threshold > 0)) {
    return { ok: false, status: 409, code: "CONFLICT", message: "Certificate is disabled for this course (passing grade is 0)." };
  }

  const placementRaw = (settings as { name_placement_json?: unknown } | null)?.name_placement_json;
  const placement = (placementRaw && typeof placementRaw === "object" ? (placementRaw as Placement) : null) as Placement | null;
  if (!placement || !Number.isFinite(Number(placement.page))) {
    return { ok: false, status: 409, code: "CONFLICT", message: "Certificate name placement is not configured yet." };
  }

  const userFullName = readString(userRow as Record<string, unknown> | null, "full_name");
  const userEmail = readString(userRow as Record<string, unknown> | null, "email");
  const displayName = userFullName ?? userEmail ?? "Member";

  const { data: file, error: dlErr } = await admin.storage.from(tpl.storage_bucket).download(tpl.storage_path);
  if (dlErr || !file) {
    return { ok: false, status: 500, code: "INTERNAL", message: "Failed to download template." };
  }
  const templateBytes = await file.arrayBuffer();

  const mime = String((tpl as { mime_type?: unknown }).mime_type ?? "");
  let pdfDoc: PDFDocument;

  if (mime === "application/pdf") {
    pdfDoc = await PDFDocument.load(templateBytes);
  } else if (mime === "image/png" || mime === "image/jpeg") {
    pdfDoc = await PDFDocument.create();
    const embedded = mime === "image/png" ? await pdfDoc.embedPng(templateBytes) : await pdfDoc.embedJpg(templateBytes);
    const { width, height } = embedded.scale(1);
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(embedded, { x: 0, y: 0, width, height });
  } else {
    return {
      ok: false,
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Unsupported template image type for generation. Please upload PDF, PNG, or JPG.",
    };
  }

  const pages = pdfDoc.getPages();
  const pageIndex = Math.max(0, Math.min(pages.length - 1, Math.floor(Number(placement.page) - 1)));
  const targetPage = pages[pageIndex];
  const pageW = targetPage.getWidth();
  const pageH = targetPage.getHeight();

  const font = await pdfDoc.embedFont(pickStandardFontName(placement.fontFamily));
  const desiredFontSize = Number.isFinite(Number(placement.fontSize)) ? Math.max(6, Math.min(200, Number(placement.fontSize))) : 32;
  const maxTextWidth = placement.wPct !== undefined ? clamp01(Number(placement.wPct)) * pageW : null;
  const fontSize = fitFontSizeToWidth({ font, text: displayName, desired: desiredFontSize, maxWidth: maxTextWidth });
  const align = placement.align === "left" || placement.align === "right" || placement.align === "center" ? placement.align : "center";
  const color = parseHexColor(placement.color) ?? { r: 0.07, g: 0.07, b: 0.07 };

  const xPct = clamp01(Number(placement.xPct));
  const yPct = clamp01(Number(placement.yPct));
  const textWidth = font.widthOfTextAtSize(displayName, fontSize);
  const xCenter = xPct * pageW;
  const x = align === "center" ? xCenter - textWidth / 2 : align === "right" ? xCenter - textWidth : xCenter;
  const yFromTop = yPct * pageH;
  const y = Math.max(0, pageH - yFromTop - fontSize / 2);

  targetPage.drawText(displayName, {
    x: Math.max(0, Math.min(pageW - 1, x)),
    y: Math.max(0, Math.min(pageH - 1, y)),
    size: fontSize,
    font,
    color: rgb(color.r, color.g, color.b),
  });

  const outBytes = await pdfDoc.save();
  const courseTitle = readString(courseRow as Record<string, unknown> | null, "title") ?? "Untitled course";
  const certificateTitle = readString(settings as Record<string, unknown> | null, "certificate_title") ?? "Certificate";
  const baseName = safeFilename(certificateTitle || `Certificate - ${courseTitle}`);
  const fileName = `${baseName}.pdf`;
  const bucket = "certificates";
  const path = `orgs/${orgId}/courses/${courseId}/users/${userId}/cert-${certificateId}.pdf`;

  const uploadRes = await admin.storage.from(bucket).upload(path, outBytes, { contentType: "application/pdf", upsert: true });
  if (uploadRes.error) {
    return { ok: false, status: 500, code: "INTERNAL", message: "Failed to store generated certificate." };
  }

  const now = new Date().toISOString();
  const { error: updErr } = await admin
    .from("certificates")
    .update({
      storage_bucket: bucket,
      storage_path: path,
      file_name: fileName,
      mime_type: "application/pdf",
      size_bytes: outBytes.byteLength,
      generated_at: now,
      template_id: (tpl as { id?: unknown }).id ?? null,
      course_title_snapshot: courseTitle,
      organization_name_snapshot: readString(orgRow as Record<string, unknown> | null, "name"),
      organization_slug_snapshot: readString(orgRow as Record<string, unknown> | null, "slug"),
      user_full_name_snapshot: userFullName,
      user_email_snapshot: userEmail,
      certificate_title_snapshot: certificateTitle,
    })
    .eq("id", certificateId);
  if (updErr) {
    return { ok: false, status: 500, code: "INTERNAL", message: "Failed to save generated certificate metadata." };
  }

  return { ok: true, bucket, path, fileName, generated: true };
}
