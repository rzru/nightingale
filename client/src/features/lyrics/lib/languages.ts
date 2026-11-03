import { t } from '@/i18n';

export const LANGUAGES = [
  ['en', 'languages.english'],
  ['es', 'languages.spanish'],
  ['fr', 'languages.french'],
  ['de', 'languages.german'],
  ['it', 'languages.italian'],
  ['pt', 'languages.portuguese'],
  ['ru', 'languages.russian'],
  ['ja', 'languages.japanese'],
  ['ko', 'languages.korean'],
  ['zh', 'languages.mandarin'],
  ['yue', 'languages.cantonese'],
  ['ar', 'languages.arabic'],
  ['hi', 'languages.hindi'],
  ['nl', 'languages.dutch'],
  ['pl', 'languages.polish'],
  ['sv', 'languages.swedish'],
  ['tr', 'languages.turkish'],
  ['uk', 'languages.ukrainian'],
  ['cs', 'languages.czech'],
  ['ro', 'languages.romanian'],
  ['hu', 'languages.hungarian'],
] as const;

const LANGUAGE_NAMES = new Map<string, string>(LANGUAGES);

export function getLanguageName(language: string): string {
  const key = LANGUAGE_NAMES.get(language.toLowerCase());
  return key !== undefined ? t(key) : language.toUpperCase();
}
