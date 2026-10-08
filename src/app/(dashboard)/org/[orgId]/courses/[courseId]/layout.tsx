import {NextIntlClientProvider} from 'next-intl';
import {notFound, redirect} from 'next/navigation';
import {createServerSupabaseClient, getServerUser} from '@/lib/supabase/server';
import {resolveOrgKey} from '@/lib/organizations/resolveOrgKey';
import {getCourseLocale} from '@/i18n/course';
import {LanguageSwitcher} from '@/components/ui/LanguageSwitcher';

export default async function CourseLanguageLayout({children, params}: {
  children: React.ReactNode;
  params: Promise<{orgId: string; courseId: string}>;
}) {
  const {user} = await getServerUser();
  if (!user) redirect('/');
  // Authoring follows the administrator's app preference; course defaults apply to learning.
  if (user.role !== 'member') return children;
  const {orgId: orgKey, courseId: courseKey} = await params;
  const {org} = await resolveOrgKey(orgKey);
  if (!org) notFound();
  const supabase = await createServerSupabaseClient();
  let query = supabase.from('courses').select('id').eq('organization_id', org.id);
  query = /^[0-9a-f-]{36}$/i.test(courseKey) ? query.eq('id', courseKey) : query.eq('slug', courseKey);
  const {data: course} = await query.maybeSingle();
  if (!course?.id) notFound();
  const locale = await getCourseLocale(course.id);
  return (
    <NextIntlClientProvider locale={locale}>
      <div className="mb-4 flex justify-end"><LanguageSwitcher courseId={course.id} /></div>
      {children}
    </NextIntlClientProvider>
  );
}
