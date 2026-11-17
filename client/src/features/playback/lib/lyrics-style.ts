/**
 * Look of the karaoke text: colour that fills a word as it is sung, outline
 * and font. Stored in the config as preset names.
 */

export type LyricsFillColor = 'white' | 'yellow' | 'cyan' | 'green' | 'pink';
export type LyricsOutline = 'none' | 'black' | 'blue';
export type LyricsFont = 'system' | 'serif' | 'narrow' | 'mono';

export const DEFAULT_LYRICS_FILL_COLOR: LyricsFillColor = 'white';
export const DEFAULT_LYRICS_OUTLINE: LyricsOutline = 'none';
export const DEFAULT_LYRICS_FONT: LyricsFont = 'system';

const FILL_COLORS: Record<LyricsFillColor, string> = {
  white: 'rgb(255,255,255)',
  yellow: 'rgb(255,216,77)',
  cyan: 'rgb(95,227,255)',
  green: 'rgb(125,255,138)',
  pink: 'rgb(255,138,216)',
};

const OUTLINE_COLORS: Record<LyricsOutline, string | null> = {
  none: null,
  black: 'rgb(0,0,0)',
  blue: 'rgb(16,24,96)',
};

// Every stack ends in a generic family and starts with fonts that carry
// Cyrillic on Windows and on common Linux desktops.
const FONT_STACKS: Record<LyricsFont, string | null> = {
  system: null,
  serif: 'Georgia, "Times New Roman", "DejaVu Serif", "Liberation Serif", serif',
  narrow:
    'Bahnschrift, "Arial Narrow", "DejaVu Sans Condensed", "Liberation Sans Narrow", sans-serif',
  mono: 'Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace',
};

const pick = <V>(table: Readonly<Record<string, V>>, value: unknown, fallback: V): V =>
  typeof value === 'string' && Object.hasOwn(table, value) ? (table[value] ?? fallback) : fallback;

export type LyricsStyleVars = {
  '--lyric-sung': string;
  '--lyric-stroke': string;
  '--lyric-stroke-width': string;
  fontFamily?: string;
};

type LyricsStyleInput = {
  fillColor?: string | null;
  outline?: string | null;
  font?: string | null;
};

/** CSS variables and font for the lyrics container. */
export function lyricsStyleVars({ fillColor, outline, font }: LyricsStyleInput): LyricsStyleVars {
  const stroke = pick(OUTLINE_COLORS, outline, OUTLINE_COLORS[DEFAULT_LYRICS_OUTLINE]);
  const family = pick(FONT_STACKS, font, FONT_STACKS[DEFAULT_LYRICS_FONT]);
  return {
    '--lyric-sung': pick(FILL_COLORS, fillColor, FILL_COLORS[DEFAULT_LYRICS_FILL_COLOR]),
    '--lyric-stroke': stroke ?? 'transparent',
    '--lyric-stroke-width': stroke === null ? '0' : '0.06em',
    ...(family === null ? {} : { fontFamily: family }),
  };
}
