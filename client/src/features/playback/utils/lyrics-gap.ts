import { t } from '@/i18n';
import timing from '@/shared/config/lyrics-timing.json';
import type { Segment } from '@/types/Transcript';

// Small timing leads keep lyric transitions visually in sync with the audio.
export const LYRICS_LEAD = timing.lyricsLead;
export const WORD_HIGHLIGHT_LEAD = timing.wordHighlightLead;
export const SEGMENT_LINGER = timing.segmentLinger;
export const GAP_THRESHOLD_SEC = timing.gapThreshold;
export const BUBBLE_COUNTDOWN_SEC = timing.bubbleCountdown;

/** Finds the displayed segment, using `hint` to skip already-passed entries. */
export function findCurrentSegment(segments: Segment[], time: number, hint: number): number {
  const start = hint < segments.length && time >= segments[hint].start - LYRICS_LEAD ? hint : 0;

  for (let i = start; i < segments.length; i++) {
    if (time >= segments[i].end + SEGMENT_LINGER) {
      const next = i + 1;

      // Keep a finished line through short pauses until the next line's lead-in.
      if (
        next < segments.length &&
        segments[next].start - segments[i].end < GAP_THRESHOLD_SEC &&
        time < segments[next].start - LYRICS_LEAD
      ) {
        return i;
      }

      continue;
    }

    const next = i + 1;
    if (next < segments.length && time >= segments[next].start - LYRICS_LEAD) {
      return next;
    }

    return i;
  }

  return Math.max(0, segments.length - 1);
}

export function computeLyricGapCaption(
  segments: Segment[],
  time: number,
  segIdx: number,
): string | null {
  const seg = segments.at(segIdx);
  if (!seg) {
    return null;
  }

  // Intro gaps do not get a HUD caption.
  if (segIdx === 0) {
    return null;
  }

  const gapBefore = seg.start - segments[segIdx - 1].end;
  const timeUntil = seg.start - time;
  const inGap = gapBefore >= GAP_THRESHOLD_SEC && timeUntil > 0;
  if (!inGap) {
    return null;
  }

  return t('playback.lyrics.nextIn', { seconds: Math.ceil(timeUntil) });
}
