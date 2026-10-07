import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

let supabaseHostname: string | undefined;

try {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  supabaseHostname = supabaseUrl ? new URL(supabaseUrl).hostname : undefined;
} catch {
  // If NEXT_PUBLIC_SUPABASE_URL is missing or invalid, don't allow any remote patterns.
  supabaseHostname = undefined;
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: supabaseHostname
      ? [
      {
            protocol: "https",
            hostname: supabaseHostname,
            pathname: "/storage/v1/object/public/**",
      },
        ]
      : [],
  },
};

export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig);
