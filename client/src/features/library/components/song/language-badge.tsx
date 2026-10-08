import { getLanguageName } from '@/features/lyrics/lib/languages';
import type { Song } from '@/types/Song';

const UNKNOWN_LANGUAGE_CODES = new Set(['un', 'und', 'unk', 'unknown']);

/** A small tag matching the language badge, marking a song backed by a sealed
 * `.nge` bundle. Renders nothing for non-`.nge` songs, so call sites can drop
 * it in unconditionally next to the language code. */
export function NgeBadge({ song }: { song: Song }) {
  if (!song.path.toLowerCase().endsWith('.nge')) {
    return null;
  }

  return (
    <span
      className="inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-sm bg-blue-500/12 px-1 text-center font-mono text-[0.5625rem] leading-none font-semibold tracking-tight text-blue-600 ring-1 ring-blue-500/30 ring-inset dark:text-blue-400 dark:ring-blue-400/30"
      title="Nightingale bundle (.nge)"
      aria-label="Nightingale bundle file"
    >
      NGE
    </span>
  );
}

/** Whether a language is concrete enough to surface in the UI. Provided LRC
 * songs default to "unknown", which we hide rather than show as "UN". */
export function isDisplayableLanguage(language?: string | null): language is string {
  return (
    typeof language === 'string' &&
    language !== '' &&
    !UNKNOWN_LANGUAGE_CODES.has(language.trim().toLowerCase())
  );
}

export function LanguageBadge({ language }: { language?: string | null }) {
  if (!isDisplayableLanguage(language)) {
    return null;
  }

  const shortCode = language.slice(0, 2).toUpperCase();

  return (
    <span
      className="inline-grid size-5 shrink-0 place-items-center rounded-sm bg-foreground/8 p-0 text-center font-mono text-[0.5625rem] leading-none font-semibold tracking-tight text-muted-foreground ring-1 ring-foreground/10 ring-inset"
      title={getLanguageName(language)}
      aria-label={`Language: ${getLanguageName(language)}`}
    >
      {shortCode}
    </span>
  );
}
