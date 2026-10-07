'use server';

import {cookies} from 'next/headers';
import {type Locale, normalizeLocale, isLocale} from '@/i18n/config';

// Browser-local preferences: app language and per-course overrides are independent.
const COOKIE_NAME = 'NEXT_LOCALE';

export async function getUserLocale() {
  return normalizeLocale((await cookies()).get(COOKIE_NAME)?.value);
}

export async function setUserLocale(locale: Locale, courseId?: string) {
  if (!isLocale(locale)) throw new Error('Unsupported language');
  if (courseId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(courseId)) throw new Error('Invalid course');
  (await cookies()).set(courseId ? `COURSE_LOCALE_${courseId}` : COOKIE_NAME, locale, {
    path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production', httpOnly: true,
  });
}

export async function clearCourseLocale(courseId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(courseId)) throw new Error('Invalid course');
  (await cookies()).delete(`COURSE_LOCALE_${courseId}`);
}
