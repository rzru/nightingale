import {
  RotateCcwIcon,
  RotateCwIcon,
  SkipBackIcon,
  SkipForwardIcon,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { usePlaybackTransportActions } from '@/features/playback/providers';
import { findCurrentSegment } from '@/features/playback/utils/lyrics-gap';
import { t } from '@/i18n';
import { cn } from '@/shared/utils/cn';
import { formatSeconds } from '@/shared/utils/format-duration';
import type { AppConfig } from '@/types/AppConfig';
import type { Segment } from '@/types/Transcript';

import { PlaybackVolumeControl } from './playback-volume-control';

const isSeekKey = (key: string) =>
  ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(key);

type TransportButtonProps = {
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
  onClick: () => void;
};

function TransportButton({
  icon: Icon,
  label,
  disabled = false,
  buttonRef,
  onClick,
}: TransportButtonProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="pointer-events-auto flex size-[28px] items-center justify-center text-white/55 transition-colors hover:text-[#f3ead7] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#f3ead7] disabled:cursor-not-allowed disabled:opacity-20 [@media(any-pointer:coarse)]:size-[44px]"
    >
      <Icon
        className="size-[16px] [@media(any-pointer:coarse)]:size-[22px]"
        aria-hidden="true"
        strokeWidth={1.75}
      />
    </button>
  );
}

/** Lyric-line jumping for whatever owns the timeline. */
export type TransportLines = {
  isAvailable: () => { previous: boolean; next: boolean };
  seek: (delta: 1 | -1) => void;
};

export type TransportControlsProps = {
  duration: number;
  subscribe: (fn: (time: number) => void) => () => void;
  getCurrentTime: () => number;
  seek: (seconds: number) => void;
  lines: TransportLines;
  className?: string;
};

/**
 * The seek slider and its buttons. Presentation only: the playback HUD binds it
 * to the local audio engine, the phone binds it to the host's published clock.
 */
export function TransportControls({
  duration,
  subscribe,
  getCurrentTime,
  seek,
  lines,
  className,
}: TransportControlsProps) {
  const timerRef = useRef<HTMLParagraphElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const previousLineRef = useRef<HTMLButtonElement>(null);
  const nextLineRef = useRef<HTMLButtonElement>(null);
  const draggingRef = useRef(false);

  const updateTime = useCallback(
    (time: number) => {
      const clamped = Math.max(0, Math.min(duration, time));
      if (!draggingRef.current) {
        if (sliderRef.current) {
          sliderRef.current.value = String(clamped);
        }
        if (timerRef.current) {
          timerRef.current.textContent = `${formatSeconds(clamped)} / ${formatSeconds(duration)}`;
        }
      }

      const available = lines.isAvailable();
      if (previousLineRef.current) {
        previousLineRef.current.disabled = !available.previous;
      }
      if (nextLineRef.current) {
        nextLineRef.current.disabled = !available.next;
      }
    },
    [duration, lines],
  );

  useEffect(() => {
    updateTime(getCurrentTime());
    return subscribe(updateTime);
  }, [getCurrentTime, subscribe, updateTime]);

  const previewSeek = useCallback(() => {
    const value = Number(sliderRef.current?.value ?? 0);
    draggingRef.current = true;
    if (timerRef.current) {
      timerRef.current.textContent = `${formatSeconds(value)} / ${formatSeconds(duration)}`;
    }
  }, [duration]);

  const commitSeek = useCallback(() => {
    draggingRef.current = false;
    seek(Math.max(0, Math.min(duration, Number(sliderRef.current?.value ?? 0))));
  }, [duration, seek]);

  const seekRelative = (seconds: number) =>
    seek(Math.max(0, Math.min(duration, getCurrentTime() + seconds)));

  return (
    <div
      className={cn('mt-1.5 w-full max-w-[340px]', className)}
      aria-label={t('playback.playbackTransportControls.playbackPosition')}
    >
      <div className="flex min-h-[28px] flex-wrap items-center justify-between gap-x-3 [@media(any-pointer:coarse)]:min-h-[44px]">
        <p ref={timerRef} className="text-[16px] text-white/60 tabular-nums">
          0:00 / {formatSeconds(duration)}
        </p>
        <div className="flex shrink-0 items-center gap-0.5">
          <TransportButton
            icon={SkipBackIcon}
            label={t('playback.playbackTransportControls.previousLyricLine')}
            buttonRef={previousLineRef}
            onClick={() => lines.seek(-1)}
          />
          <TransportButton
            icon={RotateCcwIcon}
            label={t('playback.playbackTransportControls.jump1SecondBack')}
            onClick={() => seekRelative(-1)}
          />
          <TransportButton
            icon={RotateCwIcon}
            label={t('playback.playbackTransportControls.jump1SecondForward')}
            onClick={() => seekRelative(1)}
          />
          <TransportButton
            icon={SkipForwardIcon}
            label={t('playback.playbackTransportControls.nextLyricLine')}
            buttonRef={nextLineRef}
            onClick={() => lines.seek(1)}
          />
        </div>
      </div>
      <input
        ref={sliderRef}
        type="range"
        min={0}
        max={duration}
        step={0.1}
        defaultValue={0}
        aria-label={t('playback.playbackTransportControls.seekThroughTrack')}
        onInput={previewSeek}
        onPointerUp={commitSeek}
        onPointerCancel={commitSeek}
        onKeyDown={(event) => {
          if (isSeekKey(event.key)) {
            draggingRef.current = true;
          }
        }}
        onKeyUp={(event) => isSeekKey(event.key) && commitSeek()}
        onBlur={() => draggingRef.current && commitSeek()}
        className="seek-slider block h-[14px] w-full cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f3ead7] [@media(any-pointer:coarse)]:h-[24px]"
      />
    </div>
  );
}

/** Binds the transport controls to the playback surface's own audio engine. */
export function PlaybackTransportControls({
  duration,
  segments,
  config,
}: {
  duration: number;
  segments: Segment[];
  config: AppConfig | null;
}) {
  const { subscribe, getCurrentTime, seek } = usePlaybackTransportActions();
  const hintRef = useRef(0);

  const lines = useMemo<TransportLines>(() => {
    const currentLine = () => {
      if (segments.length === 0) {
        return -1;
      }
      const index = findCurrentSegment(segments, getCurrentTime(), hintRef.current);
      hintRef.current = index;
      return index;
    };

    return {
      isAvailable: () => {
        const index = currentLine();
        return { previous: index > 0, next: index >= 0 && index < segments.length - 1 };
      },
      seek: (delta) => {
        const index = currentLine();
        if (index < 0) {
          return;
        }
        seek(segments[Math.max(0, Math.min(segments.length - 1, index + delta))].start);
      },
    };
  }, [getCurrentTime, seek, segments]);

  return (
    <div className="inline-flex max-w-full self-start items-start gap-2">
      <TransportControls
        duration={duration}
        subscribe={subscribe}
        getCurrentTime={getCurrentTime}
        seek={seek}
        lines={lines}
        className="min-w-0 w-[340px]"
      />
      <PlaybackVolumeControl config={config} />
    </div>
  );
}
