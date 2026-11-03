import {
  RotateCcwIcon,
  RotateCwIcon,
  SkipBackIcon,
  SkipForwardIcon,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';

import { usePlaybackTransportActions } from '@/features/playback/providers';
import { findCurrentSegment } from '@/features/playback/utils/lyrics-gap';
import { t } from '@/i18n';
import { formatSeconds } from '@/shared/utils/format-duration';
import type { Segment } from '@/types/Transcript';

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

export function PlaybackTransportControls({
  duration,
  segments,
}: {
  duration: number;
  segments: Segment[];
}) {
  const { subscribe, getCurrentTime, seek } = usePlaybackTransportActions();
  const timerRef = useRef<HTMLParagraphElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const previousLineRef = useRef<HTMLButtonElement>(null);
  const nextLineRef = useRef<HTMLButtonElement>(null);
  const draggingRef = useRef(false);
  const lineHintRef = useRef(0);

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

      if (segments.length > 0) {
        const index = findCurrentSegment(segments, clamped, lineHintRef.current);
        lineHintRef.current = index;
        if (previousLineRef.current) {
          previousLineRef.current.disabled = index === 0;
        }
        if (nextLineRef.current) {
          nextLineRef.current.disabled = index === segments.length - 1;
        }
      }
    },
    [duration, segments],
  );

  useEffect(() => {
    lineHintRef.current = 0;
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

  const seekLine = (offset: number) => {
    if (segments.length === 0) {
      return;
    }
    const current = findCurrentSegment(segments, getCurrentTime(), lineHintRef.current);
    seek(segments[Math.max(0, Math.min(segments.length - 1, current + offset))].start);
  };

  return (
    <div
      className="mt-1.5 w-full max-w-[340px]"
      aria-label={t('playback.playbackTransportControls.playbackPosition')}
    >
      <div className="flex h-[28px] items-center justify-between gap-3 [@media(any-pointer:coarse)]:h-[44px]">
        <p ref={timerRef} className="text-[16px] text-white/60 tabular-nums">
          0:00 / {formatSeconds(duration)}
        </p>
        <div className="flex shrink-0 items-center gap-0.5">
          <TransportButton
            icon={SkipBackIcon}
            label={t('playback.playbackTransportControls.previousLyricLine')}
            disabled={segments.length === 0}
            buttonRef={previousLineRef}
            onClick={() => seekLine(-1)}
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
            disabled={segments.length === 0}
            buttonRef={nextLineRef}
            onClick={() => seekLine(1)}
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
        className="block h-[12px] w-full cursor-pointer accent-[#f3ead7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f3ead7] [@media(any-pointer:coarse)]:h-[24px]"
      />
    </div>
  );
}
