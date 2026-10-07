"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";

export function formatLocalDateTime(iso?: string | null, fallback = "—", locale = "en"): string {
  if (!iso || typeof iso !== "string") return fallback;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString(locale);
}

export default function LocalDateTime({
  iso,
  fallback = "—",
  className,
}: {
  iso?: string | null;
  fallback?: string;
  className?: string;
}) {
  const locale = useLocale();
  const text = useMemo(() => formatLocalDateTime(iso, fallback, locale), [iso, fallback, locale]);

  return (
    <span className={className} suppressHydrationWarning>
      {text}
    </span>
  );
}
