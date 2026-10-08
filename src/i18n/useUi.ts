import {useLocale} from 'next-intl';
import {useMemo} from 'react';
import {createUiTranslator} from './ui';

export function useUi() {
  const locale = useLocale();
  return useMemo(() => createUiTranslator(locale), [locale]);
}
