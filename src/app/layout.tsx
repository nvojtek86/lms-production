import {NextIntlClientProvider} from "next-intl";
import {getLocale, getMessages} from "next-intl/server";
import {PublicLanguageSwitcher} from "@/components/ui/LanguageSwitcher";
import { AuthProvider } from "@/context/AuthProvider";
import { ThemeProvider } from "@/context/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import Script from "next/script";
import "@/styles/globals.css";
import "@/styles/theme.css";
import { PUBLIC_APP_SETTINGS_THEME_TAG, ROLE_PRIMARY_CACHE_KEY, THEME_CACHE_KEY } from "@/lib/theme/themeConstants";
import { env } from "@/env.mjs";
import { ClientErrorLogger } from "@/components/errors/ClientErrorLogger";
import { initServerErrorLogging } from "@/lib/logging/serverErrorBootstrap";
import { RolePrimaryThemeOverride } from "@/components/theme/RolePrimaryThemeOverride";

initServerErrorLogging();

function sanitizeCssValue(value: string): string {
  // Prevent breaking out of the <style> tag if someone ever stores unsafe strings in theme values.
  // (Only super_admin can update theme, but we harden anyway.)
  return value.replace(/</g, "\\3C ");
}

function themeToCss(theme: Record<string, string> | null): string {
  if (!theme) return "";
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(theme)) {
    if (!key.startsWith("--")) continue;
    if (typeof value !== "string") continue;
    pairs.push(`${key}: ${sanitizeCssValue(value)};`);
  }
  if (pairs.length === 0) return "";
  return `:root{${pairs.join("")}}`;
}

async function loadPublicThemeServer(): Promise<Record<string, string> | null> {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Use PostgREST directly so we can tag/cache this request with Next.js.
  const url = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/public_app_settings?select=theme&limit=1`;

  const res = await fetch(url, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      Accept: "application/json",
    },
    // Cache with a tag so /api/settings PATCH can invalidate it immediately.
    next: { tags: [PUBLIC_APP_SETTINGS_THEME_TAG] },
  });

  if (!res.ok) return null;

  const data = (await res.json().catch(() => null)) as unknown;
  let themeRaw: unknown = null;
  if (Array.isArray(data)) {
    const first = data[0] as unknown;
    if (first && typeof first === "object") {
      themeRaw = (first as Record<string, unknown>).theme;
    }
  } else if (data && typeof data === "object") {
    themeRaw = (data as Record<string, unknown>).theme;
  }
  if (!themeRaw) return null;

  let themeObj: unknown = themeRaw;
  if (typeof themeObj === "string") {
    try {
      themeObj = JSON.parse(themeObj);
    } catch {
      return null;
    }
  }

  if (!themeObj || typeof themeObj !== "object") return null;

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(themeObj as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const serverTheme = await loadPublicThemeServer();
  const serverThemeCss = themeToCss(serverTheme);

  // Pre-hydration theme initializer:
  // - Applies cached theme from localStorage before React hydrates (prevents flash on repeat visits).
  // - Server-inlined <style> below handles first-time visitors (no cache yet).
  // - Also applies cached role-based primary override (reduces flicker after login).
  const preHydrationThemeScript = `(function(){try{var raw=localStorage.getItem(${JSON.stringify(
    THEME_CACHE_KEY
  )});if(raw){var obj=JSON.parse(raw);if(obj&&typeof obj==="object"){for(var k in obj){if(!Object.prototype.hasOwnProperty.call(obj,k))continue;var v=obj[k];if(typeof v!=="string")continue;if(k.indexOf("--")!==0)continue;document.documentElement.style.setProperty(k,v);}}}var rp=localStorage.getItem(${JSON.stringify(
    ROLE_PRIMARY_CACHE_KEY
  )});var p=(typeof location!=="undefined"&&location&&typeof location.pathname==="string")?location.pathname:"";var dash=p.indexOf("/admin")===0||p.indexOf("/system")===0||p.indexOf("/org")===0;if(dash&&rp&&typeof rp==="string"&&rp.length){document.documentElement.style.setProperty("--brand-primary",rp);} }catch(e){}})();`;

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {serverThemeCss ? (
          <style
            id="__iso_lms_server_theme"
            dangerouslySetInnerHTML={{ __html: serverThemeCss }}
          />
        ) : null}
        <Script id="__iso_lms_theme_init" strategy="beforeInteractive">
          {preHydrationThemeScript}
        </Script>
      </head>
      <body
        className={`antialiased`}
        suppressHydrationWarning
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
        <PublicLanguageSwitcher />
        <ThemeProvider>
          <AuthProvider>
            <ClientErrorLogger />
            <RolePrimaryThemeOverride />
            {children}
            <Toaster position="top-right" richColors closeButton />
          </AuthProvider>
        </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
