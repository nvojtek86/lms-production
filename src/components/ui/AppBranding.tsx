'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { loadBranding } from '@/lib/theme/loadBranding';

type Branding = {
  app_name: string | null;
  logo_url: string | null;
  top_logo_url: string | null;
  top_logo_compact_url: string | null;
  updated_at?: string | null;
};

const FALLBACK_LOGO_SRC = "/brandingLogo.webp";
const BRANDING_CACHE_KEY = "iso_lms_branding_cache_v1";

export default function AppBranding({
  variant = "legacy",
  width = 140,
  height = 40,
}: {
  variant?: "legacy" | "top" | "top-compact";
  width?: number;
  height?: number;
}) {
  // Important: keep the initial render identical on server + client to avoid hydration mismatch.
  // We render the local fallback logo first, then swap to cached/remote branding after mount.
  const [branding, setBranding] = useState<Branding | null>(null);

  useEffect(() => {
    async function fetchBranding() {
      const branding = await loadBranding();
      setBranding(branding as Branding);
      try {
        localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify(branding));
      } catch {
        // ignore storage issues (private mode, quota, etc.)
      }
    }

    // After mount, seed from cache (async) to avoid hydration mismatch and avoid synchronous
    // setState in the effect body (some linters warn about cascading renders).
    try {
      const cached = localStorage.getItem(BRANDING_CACHE_KEY);
      if (cached) {
        setTimeout(() => {
          try {
            setBranding(JSON.parse(cached) as Branding);
          } catch {
            // ignore cache parse issues
          }
        }, 0);
      }
    } catch {
      // ignore cache issues
    }

    fetchBranding();

    const onUpdated = () => {
      void fetchBranding();
    };
    window.addEventListener('branding:updated', onUpdated);

    return () => {
      window.removeEventListener('branding:updated', onUpdated);
    };
  }, []);

  const appName = branding?.app_name || 'ISO LMS';
  const legacyLogoUrl =
    branding?.logo_url && branding.logo_url.trim().length > 0 ? branding.logo_url : null;
  const topLogoUrl =
    branding?.top_logo_url && branding.top_logo_url.trim().length > 0 ? branding.top_logo_url : null;
  const topCompactLogoUrl =
    branding?.top_logo_compact_url && branding.top_logo_compact_url.trim().length > 0
      ? branding.top_logo_compact_url
      : null;

  const logoUrl = (() => {
    switch (variant) {
      case "top":
        return topLogoUrl ?? legacyLogoUrl;
      case "top-compact":
        return topCompactLogoUrl ?? topLogoUrl ?? legacyLogoUrl;
      case "legacy":
      default:
        return legacyLogoUrl;
    }
  })();

  // Cache-bust if the URL stays the same but content changes.
  const src = logoUrl
    ? `${logoUrl}${logoUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(branding?.updated_at || '')}`
    : FALLBACK_LOGO_SRC;

  return (
    <Image
      src={src}
      width={width}
      height={height}
      alt={appName}
      priority
    />
  );
}
