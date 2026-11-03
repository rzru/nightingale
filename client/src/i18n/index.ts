import { useSyncExternalStore } from 'react';

import en from './translations/en.json';
import ru from './translations/ru.json';

const STORAGE_KEY = 'nightingale-language';
const catalogs = { en, ru } satisfies Record<string, Partial<Record<string, string>>>;
const defaultCatalog: Partial<Record<string, string>> = en;

export type Locale = keyof typeof catalogs;
export type LanguagePreference = Locale | 'system';

export const LANGUAGE_OPTIONS: { value: LanguagePreference; label: string }[] = [
  { value: 'system', label: 'settings.language.systemDefault' },
  { value: 'en', label: 'settings.language.english' },
  { value: 'ru', label: 'settings.language.russian' },
];

const listeners = new Set<() => void>();
const isLocale = (value: string): value is Locale => Object.hasOwn(catalogs, value);
const locales = Object.keys(catalogs).filter(isLocale);

const isLanguagePreference = (value: string): value is LanguagePreference =>
  value === 'system' || isLocale(value);

const readPreference = (): LanguagePreference => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved !== null && isLanguagePreference(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
};

const systemLocale = (): Locale => {
  const requested = navigator.language.toLowerCase();
  return (
    locales.find((locale) => requested === locale || requested.startsWith(`${locale}-`)) ?? 'en'
  );
};

let preference = readPreference();
let locale: Locale = preference === 'system' ? systemLocale() : preference;

const syncDocumentLanguage = () => {
  document.documentElement.lang = locale;
  document.documentElement.dir = ['ar', 'fa', 'he', 'ur'].includes(locale) ? 'rtl' : 'ltr';
};

export const translationTemplate = (key: string): string => {
  const catalog: Partial<Record<string, string>> = catalogs[locale];
  return catalog[key] ?? defaultCatalog[key] ?? key;
};

syncDocumentLanguage();

export const t = (key: string, values: Record<string, unknown> = {}): string =>
  translationTemplate(key).replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );

export const tp = (
  one: string,
  other: string,
  count: number,
  values: Record<string, unknown> = {},
): string =>
  t(new Intl.PluralRules(locale).select(count) === 'one' ? one : other, { ...values, count });

export const formatDate = (date: Date, options: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat(locale, options).format(date);

export const setLanguage = (next: string) => {
  if (!isLanguagePreference(next)) {
    return;
  }

  preference = next;
  locale = next === 'system' ? systemLocale() : next;

  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {}

  syncDocumentLanguage();
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const snapshot = () => `${preference}:${locale}`;

export const useTranslation = () => {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return { locale, preference, setLanguage, t };
};
