export type Locale = (typeof locales)[number];

export const locales = ['en', 'sr-Latn'] as const;
export const defaultLocale: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'sr-Latn';
}

export function normalizeLocale(value: unknown): Locale {
  return isLocale(value) ? value : defaultLocale;
}
