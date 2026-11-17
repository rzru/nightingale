import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { clampPlaybackScale, DEFAULT_LYRICS_SCALE } from '@/features/playback/lib/display-scale';
import { lyricsStyleVars } from '@/features/playback/lib/lyrics-style';
import {
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import {
  BUBBLE_COUNTDOWN_SEC,
  findCurrentSegment,
  GAP_THRESHOLD_SEC,
  LYRICS_LEAD,
  SEGMENT_LINGER,
  WORD_HIGHLIGHT_LEAD,
} from '@/features/playback/utils/lyrics-gap';
import { cn } from '@/shared/utils/cn';
import type { AppConfig } from '@/types/AppConfig';
import type { Segment, Word } from '@/types/Transcript';

type WordStyle = {
  rgb: string;
  opacity: number;
};

const STYLES = {
  nextLine: { rgb: 'rgb(255,255,255)', opacity: 0.35 },
  nextLineEstimated: { rgb: 'rgb(255,200,100)', opacity: 0.25 },
} as const;

// Colour of the part of a word that is not sung yet. The sung part uses the
// `--lyric-sung` variable set on the container from the settings.
const UNSUNG_COLOR = 'rgba(255,255,255,0.5)';
const UNSUNG_ESTIMATED_COLOR = 'rgba(255,200,100,0.4)';

const unsungColor = (word: Word): string =>
  word.estimated === true ? UNSUNG_ESTIMATED_COLOR : UNSUNG_COLOR;

const nextLineStyle = (word: Word): WordStyle =>
  word.estimated === true ? STYLES.nextLineEstimated : STYLES.nextLine;

// --- Per-frame DOM updates (called via rAF subscriber, no React re-renders) ---

/** Share of the word already sung, 0..1: the fill runs left to right. */
function wordProgress(word: Word, time: number, isActive: boolean): number {
  if (!isActive) {
    return 0;
  }

  const wStart = word.start - WORD_HIGHLIGHT_LEAD;
  const wEnd = word.end - WORD_HIGHLIGHT_LEAD;

  if (time >= wEnd) {
    return 1;
  }
  if (time >= wStart && wEnd > wStart) {
    return (time - wStart) / (wEnd - wStart);
  }
  return 0;
}

function updateWordSpans(
  spans: (HTMLSpanElement | null)[],
  words: Word[],
  time: number,
  isActive: boolean,
) {
  for (let i = 0; i < words.length; i++) {
    const span = spans[i];
    if (!span) {
      continue;
    }
    // Tenths of a percent are finer than a pixel at any text size.
    const fill = `${Math.round(wordProgress(words[i], time, isActive) * 1000) / 10}%`;
    if (span.dataset.fill !== fill) {
      span.dataset.fill = fill;
      span.style.setProperty('--lyric-fill', fill);
    }
  }
}

function updateCountdown(el: HTMLSpanElement | null, showCountdown: boolean, timeUntil: number) {
  if (!el) {
    return;
  }

  if (showCountdown) {
    el.style.display = '';
    el.textContent = String(Math.ceil(timeUntil));
  } else {
    el.style.display = 'none';
  }
}

// --- Word rendering ---

type WordTokenProps = {
  word: Word;
  hasReading: boolean;
  isLast: boolean;
  readingClass: string;
  refSetter?: (el: HTMLSpanElement | null) => void;
  /** Static colour for the preview line; the current line is filled instead. */
  style?: WordStyle;
};

const wordTokenStyle = (word: Word, style: WordStyle | undefined) =>
  style === undefined
    ? { '--lyric-unsung': unsungColor(word) }
    : { color: style.rgb, opacity: style.opacity };

function WordToken({ word, hasReading, isLast, readingClass, refSetter, style }: WordTokenProps) {
  const fillClass = style === undefined ? 'lyric-fill' : undefined;
  return (
    <span
      ref={refSetter}
      className={hasReading ? 'inline-flex flex-col items-center leading-tight' : undefined}
      style={wordTokenStyle(word, style)}
    >
      {hasReading && (
        <span className={cn('block leading-tight font-medium opacity-80', readingClass, fillClass)}>
          {word.reading ?? '\u00A0'}
        </span>
      )}
      <span className={fillClass}>{word.word}</span>
      {!hasReading && !isLast && word.joined !== true ? ' ' : ''}
    </span>
  );
}

type LyricsVerticalPosition = NonNullable<AppConfig['lyrics_vertical_position']>;

type LyricsHorizontalPosition = NonNullable<AppConfig['lyrics_horizontal_position']>;

type LyricsRomanizationMode = NonNullable<AppConfig['lyrics_romanization_mode']>;

const verticalClass: Record<LyricsVerticalPosition, string> = {
  bottom: 'top-[8rem] bottom-[calc(2rem+env(safe-area-inset-bottom))] justify-end sm:bottom-[60px]',
  center: 'inset-y-[6rem] justify-center',
  top: 'top-[calc(2rem+env(safe-area-inset-top))] bottom-[10rem] justify-start overflow-visible sm:top-[60px]',
};

const horizontalItemsClass: Record<LyricsHorizontalPosition, string> = {
  left: 'items-start',
  center: 'items-center',
  right: 'items-end',
};

const horizontalTextClass: Record<LyricsHorizontalPosition, string> = {
  left: 'text-left justify-start',
  center: 'text-center justify-center',
  right: 'text-right justify-end',
};

const COUNTDOWN_CLASS =
  'absolute -top-12 left-2 z-10 flex size-10 items-center justify-center rounded-full bg-black/40 text-[1rem] font-bold text-white sm:-left-9 sm:-top-9';

const lineClass = (
  hasReading: boolean,
  base: string,
  gap: string,
  horizontalPosition: LyricsHorizontalPosition,
) =>
  hasReading
    ? `flex flex-wrap items-end ${horizontalTextClass[horizontalPosition]} ${gap} ${base}`
    : `${horizontalTextClass[horizontalPosition]} ${base}`;

// --- Component ---

const hasReading = (word: Word): boolean => typeof word.reading === 'string' && word.reading !== '';

const wordKey = (word: Word): string => `${word.start}-${word.end}-${word.word}`;

type SegmentVisibility = {
  segment: Segment;
  isActive: boolean;
  bridgeShortGap: boolean;
  showCountdown: boolean;
  showCurrent: boolean;
  showNext: boolean;
  timeUntil: number;
};

const segmentEdges = (segments: readonly Segment[], index: number) => ({
  gapBefore: index === 0 ? segments[index].start : segments[index].start - segments[index - 1].end,
  nextStart: index + 1 < segments.length ? segments[index + 1].start : Infinity,
});

function segmentVisibility(
  segments: readonly Segment[],
  index: number,
  time: number,
): SegmentVisibility {
  const segment = segments[index];
  const { gapBefore, nextStart } = segmentEdges(segments, index);
  const timeUntil = segment.start - time;
  const isActive = time >= segment.start - LYRICS_LEAD && time <= segment.end + SEGMENT_LINGER;
  const showCountdown =
    gapBefore >= GAP_THRESHOLD_SEC && timeUntil > 0 && timeUntil <= BUBBLE_COUNTDOWN_SEC;
  const bridgeShortGap =
    time > segment.end + SEGMENT_LINGER && nextStart - segment.end < GAP_THRESHOLD_SEC;
  const showCurrent = isActive || showCountdown || bridgeShortGap;
  const nextIsContinuous =
    index + 1 < segments.length && nextStart - segment.end < GAP_THRESHOLD_SEC;
  const inLongGap = gapBefore >= GAP_THRESHOLD_SEC && timeUntil > LYRICS_LEAD;
  const showNext = [showCurrent, nextIsContinuous, !inLongGap || showCountdown].every(Boolean);

  return {
    segment,
    isActive,
    bridgeShortGap,
    showCountdown,
    showCurrent,
    showNext,
    timeUntil,
  };
}

type LyricsDisplayProps = {
  segments: Segment[];
  verticalPosition?: LyricsVerticalPosition | null;
  horizontalPosition?: LyricsHorizontalPosition | null;
  scale?: number | null;
  romanizationMode: LyricsRomanizationMode;
  /** Preset names from the settings; see `lyrics-style.ts`. */
  fillColor?: string | null;
  outline?: string | null;
  font?: string | null;
};

const lyricPositions = (props: LyricsDisplayProps) => ({
  vertical: props.verticalPosition ?? 'bottom',
  horizontal: props.horizontalPosition ?? 'center',
});

function LyricsDisplayImpl(props: LyricsDisplayProps) {
  const { segments, romanizationMode, fillColor, outline, font } = props;
  const styleVars = useMemo(
    () => lyricsStyleVars({ fillColor, outline, font }),
    [fillColor, outline, font],
  );
  const { vertical, horizontal } = lyricPositions(props);
  const scale = clampPlaybackScale(props.scale, DEFAULT_LYRICS_SCALE);
  const currentFontSize = `clamp(${1.35 * scale}rem, ${7 * scale}svh, ${2.5 * scale}rem)`;
  const nextFontSize = `clamp(${0.9 * scale}rem, ${4.5 * scale}svh, ${1.5 * scale}rem)`;
  const { isPlaying, paused } = usePlaybackTransportState();
  const { subscribe, getCurrentTime } = usePlaybackTransportActions();
  const animate = isPlaying && !paused;

  const [segIdx, setSegIdx] = useState(() =>
    segments.length === 0 ? 0 : findCurrentSegment(segments, getCurrentTime(), 0),
  );

  const hintRef = useRef(0);
  const renderedIdxRef = useRef(segIdx);
  const appliedIdxRef = useRef<number | null>(null);
  const applyRef = useRef<((time: number) => void) | null>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const countdownRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nextContainerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (segments.length === 0) {
      return undefined;
    }

    let raf = 0;
    let cancelled = false;

    const apply = (time: number) => {
      const idx = findCurrentSegment(segments, time, hintRef.current);
      if (idx !== hintRef.current) {
        hintRef.current = idx;
        setSegIdx(idx);
      }

      // Wait for React to render the new segment before mutating its visibility.
      if (idx !== renderedIdxRef.current) {
        return;
      }

      const visibility = segmentVisibility(segments, idx, time);

      if (containerRef.current) {
        containerRef.current.style.display = visibility.showCurrent ? '' : 'none';
      }
      if (nextContainerRef.current) {
        nextContainerRef.current.style.display = visibility.showNext ? '' : 'none';
      }

      updateCountdown(countdownRef.current, visibility.showCountdown, visibility.timeUntil);
      // Bridged finished lines are past every word's end, so treating them as
      // active keeps the already-sung colors instead of dropping to unsung.
      updateWordSpans(
        wordRefs.current,
        visibility.segment.words,
        time,
        visibility.isActive || visibility.bridgeShortGap,
      );
      appliedIdxRef.current = idx;
    };

    applyRef.current = apply;

    const cleanup = () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (applyRef.current === apply) {
        applyRef.current = null;
        appliedIdxRef.current = null;
      }
    };

    apply(getCurrentTime());

    let unsubscribe = () => {};
    if (animate) {
      const loop = () => {
        if (cancelled) {
          return;
        }
        apply(getCurrentTime());
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    } else {
      unsubscribe = subscribe((time) => apply(time));
    }

    return () => {
      cleanup();
      unsubscribe();
    };
  }, [segments, subscribe, getCurrentTime, animate]);

  // Synchronize visibility with the committed segment before paint.
  useLayoutEffect(() => {
    renderedIdxRef.current = segIdx;
    if (appliedIdxRef.current !== segIdx) {
      applyRef.current?.(getCurrentTime());
    }
  }, [segIdx, getCurrentTime]);

  if (segments.length === 0) {
    return null;
  }

  const seg = segments[segIdx];
  const nextSeg = segIdx + 1 < segments.length ? segments[segIdx + 1] : null;

  const readingDisabled = romanizationMode === 'disabled';
  const segHasReading = !readingDisabled && seg.words.some(hasReading);
  const nextHasReading = !readingDisabled && (nextSeg?.words.some(hasReading) ?? false);

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 z-10 flex flex-col gap-2 overflow-hidden px-3 sm:px-10',
        verticalClass[vertical],
        horizontalItemsClass[horizontal],
      )}
      style={styleVars}
    >
      <div
        ref={containerRef}
        className="relative max-w-full rounded-lg bg-black/40 px-3 py-2 sm:px-5 sm:py-2.5"
        style={{ display: 'none' }}
      >
        <span ref={countdownRef} className={COUNTDOWN_CLASS} style={{ display: 'none' }} />
        {seg.words.length > 0 && (
          <p
            className={lineClass(
              segHasReading,
              'leading-tight font-bold',
              'gap-x-3 gap-y-1',
              horizontal,
            )}
            style={{ fontSize: currentFontSize }}
          >
            {seg.words.map((word, wi) => (
              <WordToken
                key={wordKey(word)}
                word={word}
                hasReading={segHasReading}
                isLast={wi === seg.words.length - 1}
                readingClass="text-[0.4em]"
                refSetter={(el) => {
                  wordRefs.current[wi] = el;
                }}
              />
            ))}
          </p>
        )}
      </div>

      {nextSeg && (
        <div
          ref={nextContainerRef}
          className="max-w-full rounded-md bg-black/25 px-3 py-1.5 sm:px-4"
          style={{ display: 'none' }}
        >
          <p
            className={lineClass(nextHasReading, 'leading-tight', 'gap-x-2 gap-y-0.5', horizontal)}
            style={{ fontSize: nextFontSize }}
          >
            {nextSeg.words.map((word, wi) => (
              <WordToken
                key={wordKey(word)}
                word={word}
                hasReading={nextHasReading}
                isLast={wi === nextSeg.words.length - 1}
                readingClass="text-[0.467em]"
                style={nextLineStyle(word)}
              />
            ))}
          </p>
        </div>
      )}
    </div>
  );
}

export const LyricsDisplay = memo(LyricsDisplayImpl);
