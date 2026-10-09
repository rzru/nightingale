import type { DialogMode } from '@/features/menu/hooks/use-dialog';
import type { LineWindow } from '@/types/LineWindow';
import type { Song } from '@/types/Song';
import type { Transcript } from '@/types/Transcript';

export type EditLyricsDialogMode = { mode: 'edit-lyrics'; song: Song };

export function isEditLyricsDialogMode(mode: DialogMode): mode is EditLyricsDialogMode {
  return mode !== null && typeof mode === 'object' && mode.mode === 'edit-lyrics';
}

export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '?';
  }
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds) % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

const pad2 = (value: number): string => value.toString().padStart(2, '0');

/** Format seconds as an LRC `[mm:ss.xx]` tag. */
function lrcTag(seconds: number): string {
  const centis = Math.max(0, Math.round(seconds * 100));
  const minutes = Math.floor(centis / 6000);
  const secs = Math.floor((centis % 6000) / 100);
  return `[${pad2(minutes)}:${pad2(secs)}.${pad2(centis % 100)}]`;
}

/**
 * Rebuild line-timed LRC from saved lines and their windows. A window that
 * ends before the next line starts gets an empty end tag, as in the source.
 */
export function lrcFromWindows(lines: readonly string[], windows: readonly LineWindow[]): string {
  return lines
    .flatMap((line, index) => {
      const window = windows.at(index);
      if (!window) {
        return [line];
      }
      const next = windows.at(index + 1);
      const gapAfter = next === undefined || next.start - window.end > 0.005;
      return gapAfter
        ? [`${lrcTag(window.start)}${line}`, lrcTag(window.end)]
        : [`${lrcTag(window.start)}${line}`];
    })
    .join('\n');
}

export function normalizeLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export type LrcLevel = 'none' | 'line' | 'word';

// `[mm:ss.xx]` line timestamp and `<mm:ss.xx>` word timestamp.
const LINE_TS = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/;
const WORD_TS = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/;

/**
 * Detect whether pasted text carries LRC timing. Returns "word" when any
 * `<...>` word-level timestamp is present, "line" when only `[...]` line
 * timestamps are, and "none" for plain lyrics.
 */
export function detectLrcLevel(text: string): LrcLevel {
  if (WORD_TS.test(text)) {
    return 'word';
  }
  if (LINE_TS.test(text)) {
    return 'line';
  }
  return 'none';
}

/** Strip all LRC/Enhanced LRC timestamp and metadata tags to plain lyric lines. */
export function stripLrcToPlainLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) =>
      line
        // Metadata tags like [ar:...] / [ti:...] / [offset:...].
        .replace(/\[[a-z]+:[^\]]*\]/gi, '')
        // Line timestamps `[mm:ss.xx]` (possibly repeated).
        .replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '')
        // Word timestamps `<mm:ss.xx>`.
        .replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '')
        .trim(),
    )
    .filter((line) => line.length > 0);
}

export function linesFromTranscript(transcript: Transcript): string {
  return transcript.segments
    .map((s) => s.text.trim())
    .filter((s) => s.length > 0)
    .join('\n');
}
