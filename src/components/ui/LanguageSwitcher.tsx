'use client';

import {useLocale} from 'next-intl';
import {useRouter, usePathname} from 'next/navigation';
import {useId, useState, useTransition} from 'react';
import {setUserLocale, clearCourseLocale} from '@/services/locale';
import {isLocale} from '@/i18n/config';
import {useUi} from '@/i18n/useUi';

export function LanguageSwitcher({courseId}: {courseId?: string}) {
  const id = useId();
  const locale = useLocale();
  const ui = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="sr-only">
        {ui(courseId ? 'Course interface language' : 'Change language')}
      </label>
      <select
        id={id}
        aria-label={ui(courseId ? 'Course interface language' : 'Change language')}
        value={locale}
        disabled={pending}
        className="rounded-md border bg-background px-2 py-2 text-sm text-foreground"
        onChange={event => {
          const next = event.target.value;
          if (!isLocale(next)) return;
          setError(ui(''));
          startTransition(async () => {
            try {
              await setUserLocale(next, courseId);
              router.refresh();
            } catch {
              setError(ui('Could not change language. Please try again.'));
            }
          });
        }}
      >
        <option value="en">English</option>
        <option value="sr-Latn">Srpski (latinica)</option>
      </select>
      {courseId ? <button type="button" disabled={pending} className="text-xs underline"
        onClick={() => startTransition(async () => {
          try {
            await clearCourseLocale(courseId);
            router.refresh();
          } catch {
            setError(ui('Could not change language. Please try again.'));
          }
        })}>{ui('Use course default')}</button> : null}
      {pending ? <span role="status" className="text-xs">{ui('Changing language…')}</span> : null}
      {error ? <span role="alert" className="text-xs text-destructive">{ui(error)}</span> : null}
    </div>
  );
}

export function PublicLanguageSwitcher() {
  const pathname = usePathname();
  if (/^\/(admin|system|org)(?:\/|$)/.test(pathname)) return null;
  return <div className="fixed bottom-3 right-3 z-[60] rounded-md bg-background shadow-sm p-1"><LanguageSwitcher /></div>;
}
