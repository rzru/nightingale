import { forwardRef, memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { usePlaybackConfigPersist } from '@/features/playback/hooks/use-playback-config-persist';
import type { VideoFlavor } from '@/features/playback/lib/video-flavor';
import {
  usePlaybackMicActions,
  usePlaybackMicState,
  usePlaybackThemeActions,
  usePlaybackThemeState,
  usePlaybackTranscriptActions,
  usePlaybackTranscriptState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import { computeLyricGapCaption, findCurrentSegment } from '@/features/playback/utils/lyrics-gap';
import type { AppConfig } from '@/types/AppConfig';

import { isPixabayTheme, themeName } from './theme';

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds) % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatGuideText(volume: number): string {
  const pct = Math.round(volume * 100);
  return pct === 0 ? 'Guide: OFF' : `Guide: ${pct}% [G +/-]`;
}

function formatThemeText(themeIndex: number, videoFlavor: VideoFlavor): string {
  return `Theme: ${themeName(themeIndex, videoFlavor)} [T${isPixabayTheme(themeIndex) ? '/F' : ''}]`;
}

const SkipButton = forwardRef<HTMLButtonElement, { label: string; onClick: () => void }>(
  ({ label, onClick }, ref) => (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="pointer-events-auto flex gap-1 rounded-sm border-2 border-white/70 bg-black/10 px-2.5 py-1 text-sm text-white/90 transition-colors hover:bg-black/20"
      style={{ display: 'none' }}
    >
      <span>{label}</span> <span>⏎</span>
    </button>
  ),
);

function HintText({ children, fontSize = 'sm' }: { children: React.ReactNode; fontSize?: string }) {
  return <p className={`text-${fontSize} text-white/50`}>{children}</p>;
}

const NOTE_BASE_CLASS = `pointer-events-none absolute z-20 text-[0.6rem] text-white/30`;
const TOUCH_QUERIES = ['(pointer: coarse)', '(any-pointer: coarse)'];

function hasTouchInput(): boolean {
  return (
    typeof window !== 'undefined' &&
    (navigator.maxTouchPoints > 0 ||
      TOUCH_QUERIES.some((query) => window.matchMedia(query).matches))
  );
}

function useHasTouchInput(): boolean {
  const [enabled, setEnabled] = useState(hasTouchInput);

  useEffect(() => {
    const media = TOUCH_QUERIES.map((query) => window.matchMedia(query));
    const sync = () => setEnabled(hasTouchInput());

    sync();
    media.forEach((item) => item.addEventListener('change', sync));
    return () => media.forEach((item) => item.removeEventListener('change', sync));
  }, []);

  return enabled;
}

function TouchButton({
  label,
  onClick,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="pointer-events-auto rounded-sm border-2 border-white/70 bg-black/10 px-2.5 py-1 text-sm text-white/90 transition-colors hover:bg-black/20 active:bg-black/30 disabled:opacity-35"
    >
      {label}
    </button>
  );
}

function SettingsInfo({
  guideVolume,
  guideAvailable,
  micUserEnabled,
  micName,
  micMonitorUserEnabled,
  themeIndex,
  videoFlavor,
  showShortcuts,
}: {
  guideVolume: number;
  guideAvailable: boolean;
  micUserEnabled: boolean;
  micName: string;
  micMonitorUserEnabled: boolean;
  themeIndex: number;
  videoFlavor: VideoFlavor;
  showShortcuts: boolean;
}) {
  return (
    <div className="flex flex-col items-end">
      {guideAvailable && (
        <HintText>
          {showShortcuts
            ? formatGuideText(guideVolume)
            : `Guide: ${Math.round(guideVolume * 100)}%`}
        </HintText>
      )}
      <HintText>
        Mic: {micUserEnabled ? micName : 'OFF'}
        {showShortcuts ? ' [M/N]' : ''}
      </HintText>
      <HintText>
        Monitor: {micMonitorUserEnabled ? 'ON' : 'OFF'}
        {showShortcuts ? ' [R]' : ''}
      </HintText>
      <HintText>
        {showShortcuts
          ? formatThemeText(themeIndex, videoFlavor)
          : `Theme: ${themeName(themeIndex, videoFlavor)}`}
      </HintText>
      {showShortcuts && <HintText>[ESC] Back</HintText>}
    </div>
  );
}

function TouchControls({
  config,
  hasTouch,
  position,
}: {
  config: AppConfig | null;
  hasTouch: boolean;
  position: PlaybackHudPosition;
}) {
  const [open, setOpen] = useState(false);
  const { guideVolume, guideAvailable } = usePlaybackTransportState();
  const { setGuideVolume, handlePause } = usePlaybackTransportActions();
  const { micUserEnabled, micName, micMonitorUserEnabled } = usePlaybackMicState();
  const { handleToggleMic, handleCycleMic, handleToggleMicMonitor } = usePlaybackMicActions();
  const { themeIndex, videoFlavor } = usePlaybackThemeState();
  const { cycleTheme, cycleFlavor } = usePlaybackThemeActions();
  const persistConfig = usePlaybackConfigPersist(config);

  const setPersistedGuideVolume = useCallback(
    (volume: number) => {
      const next = Math.max(0, Math.min(1, volume));
      setGuideVolume(next);
      persistConfig({ guide_volume: next });
    },
    [persistConfig, setGuideVolume],
  );

  if (!hasTouch) {
    return null;
  }

  const touchLayoutClass = position === 'bottom' ? 'mb-2 flex-col-reverse' : 'mt-2 flex-col';

  return (
    <div className={`flex w-[min(18rem,80vw)] items-end gap-2 ${touchLayoutClass}`}>
      <div className="sm:hidden">
        <SettingsInfo
          guideVolume={guideVolume}
          guideAvailable={guideAvailable}
          micUserEnabled={micUserEnabled}
          micName={micName}
          micMonitorUserEnabled={micMonitorUserEnabled}
          themeIndex={themeIndex}
          videoFlavor={videoFlavor}
          showShortcuts={false}
        />
      </div>

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="pointer-events-auto rounded-sm border-2 border-white/70 bg-black/10 px-2.5 py-1 text-sm text-white/90 transition-colors hover:bg-black/20 active:bg-black/30"
      >
        {open ? 'Hide controls' : 'Playback controls'}
      </button>

      {open && (
        <div className="grid w-full grid-cols-3 gap-2 text-center">
          <TouchButton label="Pause" onClick={handlePause} />
          {guideAvailable && (
            <>
              <TouchButton
                label={guideVolume === 0 ? 'Guide On' : 'Guide Off'}
                onClick={() => setPersistedGuideVolume(guideVolume > 0 ? 0 : 0.3)}
              />
              <TouchButton
                label="Guide +"
                onClick={() => setPersistedGuideVolume(guideVolume + 0.1)}
              />
              <TouchButton
                label="Guide -"
                onClick={() => setPersistedGuideVolume(guideVolume - 0.1)}
              />
            </>
          )}
          <TouchButton label={micUserEnabled ? 'Mic Off' : 'Mic On'} onClick={handleToggleMic} />
          <TouchButton label="Mic Select" onClick={handleCycleMic} />
          <TouchButton
            label={micMonitorUserEnabled ? 'Monitor Off' : 'Monitor On'}
            onClick={handleToggleMicMonitor}
          />
          <TouchButton label="Theme" onClick={cycleTheme} />
          <TouchButton
            label="Flavor"
            onClick={cycleFlavor}
            disabled={!isPixabayTheme(themeIndex)}
          />
        </div>
      )}
    </div>
  );
}

type PlaybackHudPosition = 'top' | 'bottom';

function Disclaimer({
  source,
  position,
  noStems,
  micActive,
  recordingActive,
}: {
  source: string;
  position: PlaybackHudPosition;
  noStems: boolean;
  micActive: boolean;
  recordingActive: boolean;
}) {
  // No stems means we score against the original mix, so pitch scoring suffers.
  if (noStems && micActive) {
    return (
      <DisclaimerNote position={position} recordingActive={recordingActive}>
        Original mix is used, so pitch scoring will likely be inaccurate
      </DisclaimerNote>
    );
  }

  // USDX and provided LRC timings are authored, not AI-generated.
  if (source === 'usdx' || source === 'lrc') {
    return null;
  }

  const text =
    source === 'lyrics'
      ? 'Timing is AI-generated and may not be perfectly accurate'
      : 'Lyrics and timing are AI-generated and may not be perfectly accurate';

  return (
    <DisclaimerNote position={position} recordingActive={recordingActive}>
      {text}
    </DisclaimerNote>
  );
}

function DisclaimerNote({
  position,
  children,
  recordingActive,
}: {
  position: PlaybackHudPosition;
  children: ReactNode;
  recordingActive: boolean;
}) {
  return (
    <p
      className={`${NOTE_BASE_CLASS} ${notePositionClass(position, recordingActive)} left-1/2 -translate-x-1/2 whitespace-nowrap text-center`}
    >
      {children}
    </p>
  );
}

function notePositionClass(hudPosition: PlaybackHudPosition, recordingActive: boolean): string {
  if (hudPosition === 'bottom') {
    return 'top-2';
  }

  return recordingActive ? 'bottom-[10rem]' : 'bottom-2';
}

function hudPositionClass(position: PlaybackHudPosition, recordingActive: boolean): string {
  if (position === 'top') {
    return 'top-[4.25rem] items-start md:top-3';
  }

  return recordingActive
    ? 'bottom-[10rem] items-end'
    : 'bottom-[calc(2rem+env(safe-area-inset-bottom))] items-end md:bottom-3';
}

function windowControlsOffsetClass(position: PlaybackHudPosition, windowControls: boolean): string {
  return windowControls && position === 'top' ? 'md:pt-9' : '';
}

function creditPositionClass(
  position: PlaybackHudPosition,
  windowControls: boolean,
  recordingActive: boolean,
): string {
  return windowControls && position === 'bottom'
    ? 'top-12'
    : notePositionClass(position, recordingActive);
}

type PlaybackHudProps = {
  title: string;
  artist: string;
  config: AppConfig | null;
  position?: PlaybackHudPosition;
  windowControls?: boolean;
  recordingActive?: boolean;
};

function PlaybackHudImpl({
  title,
  artist,
  config,
  position = 'top',
  windowControls = false,
  recordingActive = false,
}: PlaybackHudProps) {
  const { duration, guideVolume, guideAvailable } = usePlaybackTransportState();
  const { subscribe, getCurrentTime } = usePlaybackTransportActions();
  const { themeIndex, videoFlavor } = usePlaybackThemeState();
  const { firstSegmentStart, lastSegmentEnd, introSkipLeadSec, segments, transcriptSource } =
    usePlaybackTranscriptState();
  const { handleSkipIntro, handleSkipOutro } = usePlaybackTranscriptActions();
  const { pitchScore, micUserEnabled, micName, micMonitorUserEnabled } = usePlaybackMicState();

  const lastSecondRef = useRef(-1);
  const timerRef = useRef<HTMLParagraphElement>(null);
  const skipIntroRef = useRef<HTMLButtonElement>(null);
  const skipOutroRef = useRef<HTMLButtonElement>(null);
  const gapCaptionRef = useRef<HTMLOutputElement>(null);
  const gapHintRef = useRef(0);

  const showPixabayCredit = isPixabayTheme(themeIndex);
  const hasTouch = useHasTouchInput();

  // Update playback text without triggering React renders every frame.
  useEffect(() => {
    const updateGapCaption = (time: number) => {
      const el = gapCaptionRef.current;
      if (!el) {
        return;
      }
      if (segments.length === 0) {
        el.style.display = 'none';
        return;
      }
      const idx = findCurrentSegment(segments, time, gapHintRef.current);
      gapHintRef.current = idx;
      const caption = computeLyricGapCaption(segments, time, idx);
      if (typeof caption === 'string' && caption !== '') {
        el.textContent = caption;
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    };

    gapHintRef.current = 0;
    if (timerRef.current) {
      timerRef.current.textContent = `${formatTime(getCurrentTime())} / ${formatTime(duration)}`;
    }
    updateGapCaption(getCurrentTime());

    return subscribe((time) => {
      const sec = Math.floor(time);
      if (sec !== lastSecondRef.current) {
        lastSecondRef.current = sec;
        if (timerRef.current) {
          timerRef.current.textContent = `${formatTime(time)} / ${formatTime(duration)}`;
        }
      }

      if (skipIntroRef.current) {
        skipIntroRef.current.style.display =
          time < firstSegmentStart - introSkipLeadSec ? '' : 'none';
      }
      if (skipOutroRef.current) {
        skipOutroRef.current.style.display = time > lastSegmentEnd + 1 ? '' : 'none';
      }
      updateGapCaption(time);
    });
  }, [
    subscribe,
    getCurrentTime,
    duration,
    firstSegmentStart,
    introSkipLeadSec,
    lastSegmentEnd,
    segments,
  ]);

  const hudPosition = hudPositionClass(position, recordingActive);
  const rightHudOffset = windowControlsOffsetClass(position, windowControls);
  const hudFlowClass = position === 'bottom' ? 'flex-col-reverse' : 'flex-col';
  const skipButtonsClass = position === 'bottom' ? 'mb-2' : 'mt-2';

  return (
    <>
      <div
        className={`pointer-events-auto absolute inset-x-0 z-20 flex justify-between gap-3 px-3 md:px-4 ${hudPosition}`}
      >
        <div
          className={`flex min-w-0 max-w-[58%] overflow-hidden sm:max-w-[34%] lg:max-w-[40%] ${hudFlowClass}`}
        >
          <h1 className="line-clamp-2 [overflow-wrap:anywhere] text-base leading-tight text-white md:text-[1.375rem]">
            {title}
          </h1>
          <p className="line-clamp-1 [overflow-wrap:anywhere] text-sm text-white/70 md:text-base">
            {artist}
          </p>
          <p ref={timerRef} className="text-sm text-white/70 md:text-base">
            0:00 / {formatTime(duration)}
          </p>
          <output
            ref={gapCaptionRef}
            aria-live="polite"
            className="truncate text-xs font-medium text-white/60 md:text-sm"
            style={{ display: 'none' }}
          />
          <div className={`flex gap-2 ${skipButtonsClass}`}>
            <SkipButton ref={skipIntroRef} label="Skip Intro" onClick={handleSkipIntro} />
            <SkipButton ref={skipOutroRef} label="Skip Outro" onClick={handleSkipOutro} />
          </div>
        </div>

        <div className={`flex min-w-0 items-end ${hudFlowClass} ${rightHudOffset}`}>
          <div
            className={`text-base md:text-lg ${typeof pitchScore === 'number' && pitchScore !== 0 ? 'text-white' : 'text-white/50'}`}
          >
            Score: {pitchScore ?? '--'}
          </div>
          <div className="hidden sm:block">
            <SettingsInfo
              guideVolume={guideVolume}
              guideAvailable={guideAvailable}
              micUserEnabled={micUserEnabled}
              micName={micName}
              micMonitorUserEnabled={micMonitorUserEnabled}
              themeIndex={themeIndex}
              videoFlavor={videoFlavor}
              showShortcuts={!hasTouch}
            />
          </div>
          <TouchControls config={config} hasTouch={hasTouch} position={position} />
        </div>
      </div>

      {showPixabayCredit && (
        <p
          className={`${NOTE_BASE_CLASS} ${creditPositionClass(position, windowControls, recordingActive)} right-4`}
        >
          Videos by Pixabay
        </p>
      )}

      <Disclaimer
        source={transcriptSource}
        position={position}
        noStems={!guideAvailable}
        micActive={micUserEnabled}
        recordingActive={recordingActive}
      />
    </>
  );
}

export const PlaybackHud = memo(PlaybackHudImpl);
