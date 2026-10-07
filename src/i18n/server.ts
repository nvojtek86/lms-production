import 'server-only';
import {getLocale} from 'next-intl/server';
import {createUiTranslator} from './ui';
import type {Locale} from './config';

export async function getUi(locale?: Locale) {
  return createUiTranslator(locale ?? await getLocale());
}
