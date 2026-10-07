import en from '@/messages/en.json';
import sr from '@/messages/sr-Latn.json';
import {normalizeLocale, type Locale} from './config';

export type UiValues = Record<string, string | number>;
export type UiTranslator = {
  (text: string, values?: UiValues): string;
  (text: string | null | undefined, values?: UiValues): string | null | undefined;
  locale: Locale;
  optionLabel: (label: string, value: string) => string;
};
const english = en as Record<string, string>;
const serbian = sr as Record<string, string>;
const keyByText = new Map(Object.entries(english).map(([key, text]) => [text, key]));

/** Translate interface messages only. Never pass authored course content here. */
export function createUiTranslator(locale: Locale | string) {
  const selectedLocale = normalizeLocale(locale);
  const translate = (text: string | null | undefined, values?: UiValues) => {
    if (typeof text !== 'string') return text;
    const key = keyByText.get(text);
    const message = selectedLocale === 'sr-Latn' && key ? serbian[key] ?? text : text;
    return message.replace(/\{(\w+)\}/g, (match, name: string) =>
      values && Object.hasOwn(values, name) ? String(values[name]) : match,
    );
  };
  // UUID-valued choices are authored courses, organizations or users, rather than UI labels.
  const optionLabel = (label: string, value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
      ? label : translate(label)!;
  return Object.assign(translate, {locale: selectedLocale, optionLabel}) as UiTranslator;
}
