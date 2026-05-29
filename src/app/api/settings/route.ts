import { NextRequest } from 'next/server';
import { createAdminSupabaseClient, getServerUser } from '@/lib/supabase/server';
import { revalidateTag } from "next/cache";
import { PUBLIC_APP_SETTINGS_THEME_TAG } from "@/lib/theme/themeConstants";
import { updateSettingsSchema, validateSchema } from '@/lib/validations/schemas';
import { apiError, apiOk } from "@/lib/api/response";
import { logApiEvent } from "@/lib/audit/apiEvents";

type PublicAppSettings = {
  id: string;
  app_name: string | null;
  logo_url: string | null;
  top_logo_url: string | null;
  top_logo_compact_url: string | null;
  bottom_logo_url: string | null;
  theme: Record<string, string> | string | null;
  default_language: string | null;
  timezone: string | null;
  updated_at?: string | null;
};

function parseTheme(theme: unknown): Record<string, string> | null {
  if (!theme) return null;
  if (typeof theme === 'object') return theme as Record<string, string>;
  if (typeof theme === 'string') {
    try {
      const parsed = JSON.parse(theme);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, string>;
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function GET(request: Request) {
  // super_admin only
  const { user: caller, error } = await getServerUser();
  if (error || !caller) {
    await logApiEvent({
      request,
      caller: null,
      outcome: "error",
      status: 401,
      code: "UNAUTHORIZED",
      publicMessage: "Unauthorized",
      internalMessage: typeof error === "string" ? error : "No authenticated user",
    });
    return apiError("UNAUTHORIZED", "Unauthorized", { status: 401 });
  }
  if (caller.role !== 'super_admin') return apiError("FORBIDDEN", "Forbidden", { status: 403 });

  const admin = createAdminSupabaseClient();
  const { data, error: settingsError } = await admin
    .from('public_app_settings')
    .select('id, app_name, logo_url, top_logo_url, top_logo_compact_url, bottom_logo_url, theme, default_language, timezone, updated_at')
    .single();

  if (settingsError) {
    return apiError("INTERNAL", "Failed to load settings.", { status: 500 });
  }

  const settings = data as PublicAppSettings;
  return apiOk(
    {
      settings: {
        ...settings,
        theme: parseTheme(settings.theme) ?? {},
      },
    },
    { status: 200 }
  );
}

export async function PATCH(request: NextRequest) {
  // super_admin only
  const { user: caller, error } = await getServerUser();
  if (error || !caller) {
    await logApiEvent({
      request,
      caller: null,
      outcome: "error",
      status: 401,
      code: "UNAUTHORIZED",
      publicMessage: "Unauthorized",
      internalMessage: typeof error === "string" ? error : "No authenticated user",
    });
    return apiError("UNAUTHORIZED", "Unauthorized", { status: 401 });
  }
  if (caller.role !== 'super_admin') {
    await logApiEvent({ request, caller, outcome: "error", status: 403, code: "FORBIDDEN", publicMessage: "Forbidden" });
    return apiError("FORBIDDEN", "Forbidden", { status: 403 });
  }

  // Parse body
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    await logApiEvent({ request, caller, outcome: "error", status: 400, code: "VALIDATION_ERROR", publicMessage: "Invalid JSON body." });
    return apiError("VALIDATION_ERROR", "Invalid JSON body.", { status: 400 });
  }

  // Validate with zod (partial validation - settings can update any subset of fields)
  const validation = validateSchema(updateSettingsSchema, body);
  if (!validation.success) {
    await logApiEvent({ request, caller, outcome: "error", status: 400, code: "VALIDATION_ERROR", publicMessage: validation.error });
    return apiError("VALIDATION_ERROR", validation.error, { status: 400 });
  }

  const validatedData = validation.data;

  const admin = createAdminSupabaseClient();

  // Load current row (single row) to do a safe update and for audit metadata
  const { data: current, error: currentError } = await admin
    .from('public_app_settings')
    .select('id, app_name, logo_url, top_logo_url, top_logo_compact_url, bottom_logo_url, theme, default_language, timezone')
    .single();

  if (currentError || !current) {
    await logApiEvent({
      request,
      caller,
      outcome: "error",
      status: 500,
      code: "INTERNAL",
      publicMessage: "Failed to load settings.",
      internalMessage: currentError?.message || "Settings row not found",
    });
    return apiError("INTERNAL", "Failed to load settings.", { status: 500 });
  }

  const currentSettings = current as PublicAppSettings;
  const settingsId = currentSettings.id;

  // Build the update payload
  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  // Handle app_name
  if ('app_name' in validatedData) {
    const trimmed = validatedData.app_name?.trim() || '';
    updatePayload.app_name = trimmed.length > 0 ? trimmed : null;
  }

  // Handle logo_url
  if ('logo_url' in validatedData) {
    const trimmed = validatedData.logo_url?.trim() || '';
    updatePayload.logo_url = trimmed.length > 0 ? trimmed : null;
  }

  // Handle top_logo_url
  if ('top_logo_url' in validatedData) {
    const trimmed = validatedData.top_logo_url?.trim() || '';
    updatePayload.top_logo_url = trimmed.length > 0 ? trimmed : null;
  }

  // Handle top_logo_compact_url
  if ('top_logo_compact_url' in validatedData) {
    const trimmed = validatedData.top_logo_compact_url?.trim() || '';
    updatePayload.top_logo_compact_url = trimmed.length > 0 ? trimmed : null;
  }

  // Handle default_language
  if ('default_language' in validatedData) {
    updatePayload.default_language = validatedData.default_language;
  }

  // Handle timezone
  if ('timezone' in validatedData) {
    updatePayload.timezone = validatedData.timezone;
  }

  // Handle theme
  if ('theme' in validatedData) {
    updatePayload.theme = validatedData.theme;
  }

  // Check that at least one branding field will be present after update
  const nextAppName = 'app_name' in updatePayload 
    ? updatePayload.app_name 
    : currentSettings.app_name;
  const nextLogoUrl = 'logo_url' in updatePayload 
    ? updatePayload.logo_url 
    : currentSettings.logo_url;
  const nextTopLogoUrl = 'top_logo_url' in updatePayload
    ? updatePayload.top_logo_url
    : currentSettings.top_logo_url;
  const nextTopLogoCompactUrl = 'top_logo_compact_url' in updatePayload
    ? updatePayload.top_logo_compact_url
    : currentSettings.top_logo_compact_url;

  if (!nextAppName && !nextLogoUrl && !nextTopLogoUrl && !nextTopLogoCompactUrl) {
    await logApiEvent({
      request,
      caller,
      outcome: "error",
      status: 400,
      code: "VALIDATION_ERROR",
      publicMessage: "You must provide at least one branding field.",
      internalMessage: "branding invalid: app_name and all active logo fields empty",
    });
    return apiError("VALIDATION_ERROR", "You must provide at least one branding field.", { status: 400 });
  }

  const { data: updated, error: updateError } = await admin
    .from('public_app_settings')
    .update(updatePayload)
    .eq('id', settingsId)
    .select('id, app_name, logo_url, top_logo_url, top_logo_compact_url, bottom_logo_url, theme, default_language, timezone, updated_at')
    .single();

  if (updateError || !updated) {
    await logApiEvent({
      request,
      caller,
      outcome: "error",
      status: 500,
      code: "INTERNAL",
      publicMessage: "Failed to update settings.",
      internalMessage: updateError?.message || "no updated row returned",
    });
    return apiError("INTERNAL", "Failed to update settings.", { status: 500 });
  }

  // Best-effort audit log
  try {
    await admin.from('audit_logs').insert({
      actor_user_id: caller.id,
      actor_email: caller.email,
      actor_role: caller.role,
      action: 'update_public_app_settings',
      entity: 'public_app_settings',
      entity_id: settingsId,
      metadata: {
        patch_keys: Object.keys(body as Record<string, unknown>),
      },
    });
  } catch {
    // do not block success
  }

  const updatedSettings = updated as PublicAppSettings;

  // Invalidate the server-rendered theme cache so first paint uses the latest theme immediately.
  try {
    // Next.js 16 requires a second argument for tag revalidation
    revalidateTag(PUBLIC_APP_SETTINGS_THEME_TAG, { expire: 0 });
  } catch {
    // Best-effort; do not block success.
  }

  await logApiEvent({
    request,
    caller,
    outcome: "success",
    status: 200,
    publicMessage: "Settings updated.",
    details: { patch_keys: Object.keys(body as Record<string, unknown>) },
  });

  return apiOk(
    {
      settings: {
        ...updatedSettings,
        theme: parseTheme(updatedSettings.theme) ?? {},
      },
    },
    { status: 200, message: "Settings updated." }
  );
}
