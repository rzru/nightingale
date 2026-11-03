import { useSyncExternalStore } from 'react';

import en from './translations/en.json';
import ru from './translations/ru.json';

const STORAGE_KEY = 'nightingale-language';
const RTL_LANGUAGES = new Set<string>(['ar', 'fa', 'he', 'ur']);

export type TranslationKey = keyof typeof en;

type PluralKeyOf<Key extends string> = Key extends `${infer Base}.other` ? Base : never;
export type PluralKey = PluralKeyOf<TranslationKey>;

const catalogs = { en, ru } satisfies Record<string, Record<TranslationKey, string>>;

export type Locale = keyof typeof catalogs;
export type LanguagePreference = Locale | 'system';

const defaultLocale: Locale = 'en';

const isLocale = (value: string): value is Locale => Object.hasOwn(catalogs, value);
const locales = Object.keys(catalogs).filter(isLocale);

const languageLabels = {
  en: 'languages.english',
  ru: 'languages.russian',
} satisfies Record<Locale, TranslationKey>;

export const LANGUAGE_OPTIONS: { value: LanguagePreference; label: TranslationKey }[] = [
  { value: 'system', label: 'settings.language.systemDefault' },
  ...locales.map((value) => ({ value, label: languageLabels[value] })),
];

const listeners = new Set<() => void>();
const pluralRules = new Map<Locale, Intl.PluralRules>();
const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const dictionaries = new Map<Locale, ReadonlyMap<string, string>>();

const dictionary = (target: Locale): ReadonlyMap<string, string> => {
  const cached = dictionaries.get(target);
  if (cached !== undefined) {
    return cached;
  }

  const built = new Map(Object.entries(catalogs[target]));
  dictionaries.set(target, built);
  return built;
};

const lookup = (key: string): string | undefined => dictionary(locale).get(key);

const interpolate = (template: string, values: Record<string, unknown>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  );

const matchLocale = (requested: string): Locale | undefined => {
  const tag = requested.toLowerCase();

  return locales.find((candidate) => {
    const code = candidate.toLowerCase();
    return tag === code || tag.startsWith(`${code}-`) || code.startsWith(`${tag}-`);
  });
};

const systemLocale = (): Locale => {
  for (const language of navigator.languages) {
    const match = matchLocale(language);
    if (match !== undefined) {
      return match;
    }
  }

  return defaultLocale;
};

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

let preference = readPreference();
let locale: Locale = preference === 'system' ? systemLocale() : preference;

const syncDocumentLanguage = () => {
  document.documentElement.lang = locale;
  document.documentElement.dir = RTL_LANGUAGES.has(locale) ? 'rtl' : 'ltr';
};

const applyPreference = (next: LanguagePreference, persist: boolean) => {
  preference = next;
  locale = next === 'system' ? systemLocale() : next;

  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }

  syncDocumentLanguage();
  listeners.forEach((listener) => listener());
};

export const setLanguage = (next: string) => {
  if (!isLanguagePreference(next) || next === preference) {
    return;
  }

  applyPreference(next, true);
};

window.addEventListener('storage', (event) => {
  if (event.key === null || event.key === STORAGE_KEY) {
    applyPreference(readPreference(), false);
  }
});

window.addEventListener('languagechange', () => {
  if (preference === 'system') {
    applyPreference('system', false);
  }
});

syncDocumentLanguage();

export const translationTemplate = (key: TranslationKey): string => catalogs[locale][key];

export const t = (key: TranslationKey, values: Record<string, unknown> = {}): string =>
  interpolate(translationTemplate(key), values);

export const translateText = (value: string, values: Record<string, unknown> = {}): string =>
  interpolate(lookup(value) ?? value, values);

const pluralRulesFor = (target: Locale): Intl.PluralRules => {
  const cached = pluralRules.get(target);
  if (cached !== undefined) {
    return cached;
  }

  const rules = new Intl.PluralRules(target);
  pluralRules.set(target, rules);
  return rules;
};

export const formatNumber = (value: number, options: Intl.NumberFormatOptions = {}): string => {
  const cacheKey = `${locale}:${JSON.stringify(options)}`;
  let formatter = numberFormats.get(cacheKey);

  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormats.set(cacheKey, formatter);
  }

  return formatter.format(value);
};

export const formatDate = (date: Date, options: Intl.DateTimeFormatOptions): string => {
  const cacheKey = `${locale}:${JSON.stringify(options)}`;
  let formatter = dateFormats.get(cacheKey);

  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateFormats.set(cacheKey, formatter);
  }

  return formatter.format(date);
};

export const tp = (key: PluralKey, count: number, values: Record<string, unknown> = {}): string => {
  const category = pluralRulesFor(locale).select(count);
  const template = lookup(`${key}.${category}`) ?? lookup(`${key}.other`) ?? key;

  return interpolate(template, { ...values, count: formatNumber(count) });
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

const snapshot = () => `${preference}:${locale}`;

const useLanguageSnapshot = () => useSyncExternalStore(subscribe, snapshot, snapshot);

export const useLocale = (): Locale => {
  useLanguageSnapshot();

  return locale;
};

export const useTranslation = () => {
  useLanguageSnapshot();

  return { locale, preference, setLanguage, t };
};
