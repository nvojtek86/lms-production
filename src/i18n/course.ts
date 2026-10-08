import 'server-only';
import {cache} from 'react';
import {cookies} from 'next/headers';
import {createServerSupabaseClient} from '@/lib/supabase/server';
import {isLocale, normalizeLocale, type Locale} from './config';

/** Session/RLS-bound, with compatibility for databases awaiting the approved migration. */
export const getCourseLanguage = cache(async (courseId: string): Promise<{locale: Locale; available: boolean}> => {
  const supabase = await createServerSupabaseClient();
  const {data, error} = await supabase.from('courses').select('default_language').eq('id', courseId).maybeSingle();
  if (error) {
    if (/default_language/i.test(error.message) && /column|schema cache|does not exist/i.test(error.message)) {
      return {locale: 'en', available: false};
    }
    throw new Error('Unable to load course language settings.');
  }
  return {locale: normalizeLocale(data?.default_language), available: true};
});

export async function getCourseLocale(courseId: string): Promise<Locale> {
  const override = (await cookies()).get(`COURSE_LOCALE_${courseId}`)?.value;
  if (isLocale(override)) return override;
  return (await getCourseLanguage(courseId)).locale;
}
