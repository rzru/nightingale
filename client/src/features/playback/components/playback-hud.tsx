import { forwardRef, memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { usePlaybackConfigPersist } from '@/features/playback/hooks/use-playback-config-persist';
import type { VideoFlavor } from '@/features/playback/lib/video-flavor';
import {
  usePlaybackMicActions,
  usePlaybackMicState,
  type PlaybackPlayerMicState,
  usePlaybackThemeActions,
  usePlaybackThemeState,
  usePlaybackTranscriptActions,
  usePlaybackTranscriptState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import { computeLyricGapCaption, findCurrentSegment } from '@/features/playback/utils/lyrics-gap';
import { playerDisplayName } from '@/features/playback/utils/player-display-name';
import { t, useTranslation } from '@/i18n';
import { playerColorOption } from '@/shared/player-colors';
import type { AppConfig } from '@/types/AppConfig';

import { LiveStars } from './live-stars';
import { PlaybackTransportControls } from './playback-transport-controls';
import { isPixabayTheme, themeName, type PlaybackTheme } from './theme';

function formatGuideText(volume: number): string {
  const pct = Math.round(volume * 100);
  return pct === 0
    ? t('playback.hud.guideOffShortcut')
    : t('playback.hud.guidePercentShortcut', { percent: pct });
}

function formatThemeText(theme: PlaybackTheme, videoFlavor: VideoFlavor): string {
  return t('playback.hud.themeShortcut', {
    theme: themeName(theme, videoFlavor),
    shortcut: isPixabayTheme(theme) ? 'T/F' : 'T',
  });
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
  multiplayer,
  theme,
  videoFlavor,
  showShortcuts,
}: {
  guideVolume: number;
  guideAvailable: boolean;
  micUserEnabled: boolean;
  micName: string;
  micMonitorUserEnabled: boolean;
  multiplayer: boolean;
  theme: PlaybackTheme;
  videoFlavor: VideoFlavor;
  showShortcuts: boolean;
}) {
  return (
    <div className="flex flex-col items-end">
      {guideAvailable && (
        <HintText>
          {showShortcuts
            ? formatGuideText(guideVolume)
            : t('playback.hud.guidePercent', { percent: Math.round(guideVolume * 100) })}
        </HintText>
      )}
      {!multiplayer && (
        <HintText>
          {t('playback.hud.micStatus', {
            status: micUserEnabled ? micName : t('common.states.off'),
            shortcut: showShortcuts ? ' [M/N]' : '',
          })}
        </HintText>
      )}
      <HintText>
        {t('playback.hud.monitorStatus', {
          status: t(micMonitorUserEnabled ? 'common.states.on' : 'common.states.off'),
          shortcut: showShortcuts ? ' [R]' : '',
        })}
      </HintText>
      <HintText>
        {showShortcuts
          ? formatThemeText(theme, videoFlavor)
          : t('playback.hud.theme', { theme: themeName(theme, videoFlavor) })}
      </HintText>
      {showShortcuts && <HintText>{t('playback.playbackHud.escBack')}</HintText>}
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
  const { micUserEnabled, micName, micMonitorUserEnabled, multiplayer } = usePlaybackMicState();
  const { handleToggleMic, handleCycleMic, handleToggleMicMonitor } = usePlaybackMicActions();
  const { theme, videoFlavor } = usePlaybackThemeState();
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
          multiplayer={multiplayer}
          theme={theme}
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
        {t(open ? 'playback.hud.hideControls' : 'playback.hud.showControls')}
      </button>

      {open && (
        <div className="grid w-full grid-cols-3 gap-2 text-center">
          <TouchButton label={t('common.actions.pause')} onClick={handlePause} />
          {guideAvailable && (
            <>
              <TouchButton
                label={t(guideVolume === 0 ? 'playback.hud.guideOn' : 'playback.hud.guideOff')}
                onClick={() => setPersistedGuideVolume(guideVolume > 0 ? 0 : 0.3)}
              />
              <TouchButton
                label={t('playback.playbackHud.guide')}
                onClick={() => setPersistedGuideVolume(guideVolume + 0.1)}
              />
              <TouchButton
                label={t('playback.playbackHud.guide2')}
                onClick={() => setPersistedGuideVolume(guideVolume - 0.1)}
              />
            </>
          )}
          {!multiplayer && (
            <>
              <TouchButton
                label={t(micUserEnabled ? 'playback.hud.micOff' : 'playback.hud.micOn')}
                onClick={handleToggleMic}
              />
              <TouchButton label={t('playback.playbackHud.micSelect')} onClick={handleCycleMic} />
            </>
          )}
          <TouchButton
            label={t(micMonitorUserEnabled ? 'playback.hud.monitorOff' : 'playback.hud.monitorOn')}
            onClick={handleToggleMicMonitor}
          />
          <TouchButton label={t('playback.playbackHud.theme')} onClick={cycleTheme} />
          <TouchButton
            label={t('playback.playbackHud.flavor')}
            onClick={cycleFlavor}
            disabled={!isPixabayTheme(theme)}
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
}: {
  source: string;
  position: PlaybackHudPosition;
  noStems: boolean;
  micActive: boolean;
}) {
  // No stems means we score against the original mix, so pitch scoring suffers.
  if (noStems && micActive) {
    return (
      <DisclaimerNote position={position}>
        {t('playback.playbackHud.originalMixIsUsedSoDescription')}
      </DisclaimerNote>
    );
  }

  // USDX and provided LRC timings are authored, not AI-generated.
  if (source === 'usdx' || source === 'lrc') {
    return null;
  }

  const text =
    source === 'lyrics'
      ? t('playback.hud.aiTimingDisclaimer')
      : t('playback.hud.aiLyricsTimingDisclaimer');

  return <DisclaimerNote position={position}>{text}</DisclaimerNote>;
}

function DisclaimerNote({
  position,
  children,
}: {
  position: PlaybackHudPosition;
  children: ReactNode;
}) {
  return (
    <p
      className={`${NOTE_BASE_CLASS} ${notePositionClass(position)} left-1/2 -translate-x-1/2 whitespace-nowrap text-center`}
    >
      {children}
    </p>
  );
}

function notePositionClass(hudPosition: PlaybackHudPosition): string {
  return hudPosition === 'bottom' ? 'top-2' : 'bottom-2';
}

function hudPositionClass(position: PlaybackHudPosition): string {
  return position === 'bottom'
    ? 'bottom-[calc(2rem+env(safe-area-inset-bottom))] items-end md:bottom-3'
    : 'top-[4.25rem] items-start md:top-3';
}

function windowControlsOffsetClass(position: PlaybackHudPosition, windowControls: boolean): string {
  return windowControls && position === 'top' ? 'md:pt-9' : '';
}

function creditPositionClass(position: PlaybackHudPosition, windowControls: boolean): string {
  return windowControls && position === 'bottom' ? 'top-12' : notePositionClass(position);
}

const scoreTextClass = (score: number | null): string =>
  `text-sm md:text-base ${score !== null && score !== 0 ? 'text-white' : 'text-white/50'}`;

function PlayerScore({
  player,
  players,
}: {
  player: PlaybackPlayerMicState;
  players: PlaybackPlayerMicState[];
}) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <LiveStars score={player.pitchScore} size="sm" />
      <span className={`whitespace-nowrap ${scoreTextClass(player.pitchScore)}`}>
        {playerDisplayName(player, players)}: {player.pitchScore ?? '--'}
      </span>
    </div>
  );
}

function MultiplayerScores({ players }: { players: PlaybackPlayerMicState[] }) {
  return (
    <div
      className="grid justify-items-end gap-1"
      aria-label={t('playback.playbackHud.playerScores')}
    >
      {players.map((player) => (
        <div key={player.id} className="flex items-center justify-end gap-2">
          <PlayerScore player={player} players={players} />
          <span
            className={`size-2 rounded-full ${playerColorOption(player.color).className}`}
            aria-hidden="true"
          />
          <span className="sr-only">
            {t(
              player.micReady
                ? 'playback.hud.microphoneReady'
                : 'playback.hud.microphoneUnavailable',
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

type PlaybackHudProps = {
  title: string;
  artist: string;
  config: AppConfig | null;
  position?: PlaybackHudPosition;
  windowControls?: boolean;
};

function PlaybackHudImpl({
  title,
  artist,
  config,
  position = 'top',
  windowControls = false,
}: PlaybackHudProps) {
  useTranslation();
  const { duration, guideVolume, guideAvailable } = usePlaybackTransportState();
  const { subscribe, getCurrentTime } = usePlaybackTransportActions();
  const { theme, videoFlavor } = usePlaybackThemeState();
  const { firstSegmentStart, lastSegmentEnd, introSkipLeadSec, segments, transcriptSource } =
    usePlaybackTranscriptState();
  const { handleSkipIntro, handleSkipOutro } = usePlaybackTranscriptActions();
  const { pitchScore, micUserEnabled, micName, micMonitorUserEnabled, multiplayer, players } =
    usePlaybackMicState();

  const skipIntroRef = useRef<HTMLButtonElement>(null);
  const skipOutroRef = useRef<HTMLButtonElement>(null);
  const gapCaptionRef = useRef<HTMLOutputElement>(null);
  const gapHintRef = useRef(0);

  const showPixabayCredit = isPixabayTheme(theme);
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
    updateGapCaption(getCurrentTime());

    return subscribe((time) => {
      if (skipIntroRef.current) {
        skipIntroRef.current.style.display =
          time < firstSegmentStart - introSkipLeadSec ? '' : 'none';
      }
      if (skipOutroRef.current) {
        skipOutroRef.current.style.display = time > lastSegmentEnd + 1 ? '' : 'none';
      }
      updateGapCaption(time);
    });
  }, [subscribe, getCurrentTime, firstSegmentStart, introSkipLeadSec, lastSegmentEnd, segments]);

  const hudPosition = hudPositionClass(position);
  const rightHudOffset = windowControlsOffsetClass(position, windowControls);
  const rightHudFlowClass = position === 'bottom' ? 'flex-col-reverse' : 'flex-col';
  const skipButtonsClass = position === 'bottom' ? 'mb-2' : 'mt-2';

  return (
    <>
      <div
        className={`pointer-events-auto absolute inset-x-0 z-20 flex justify-between gap-3 px-3 md:px-4 ${hudPosition}`}
      >
        <div className="flex w-[70vw] min-w-0 max-w-80 flex-col sm:max-w-[48%] lg:max-w-96">
          <h1 className="line-clamp-2 [overflow-wrap:anywhere] text-base leading-tight text-white md:text-[1.375rem]">
            {title}
          </h1>
          <p className="line-clamp-1 [overflow-wrap:anywhere] text-sm text-white/70 md:text-base">
            {artist}
          </p>
          <PlaybackTransportControls duration={duration} segments={segments} />
          <output
            ref={gapCaptionRef}
            aria-live="polite"
            className="truncate text-xs font-medium text-white/60 md:text-sm"
            style={{ display: 'none' }}
          />
          <div className={`flex gap-2 ${skipButtonsClass}`}>
            <SkipButton
              ref={skipIntroRef}
              label={t('playback.playbackHud.skipIntro')}
              onClick={handleSkipIntro}
            />
            <SkipButton
              ref={skipOutroRef}
              label={t('playback.playbackHud.skipOutro')}
              onClick={handleSkipOutro}
            />
          </div>
        </div>

        <div className={`flex min-w-0 items-end ${rightHudFlowClass} ${rightHudOffset}`}>
          <div className={`flex ${rightHudFlowClass}`}>
            {multiplayer ? (
              <MultiplayerScores players={players} />
            ) : (
              <div className="flex flex-col items-end gap-0.5">
                <LiveStars score={pitchScore} />
                <div className={scoreTextClass(pitchScore)}>
                  {t('playback.playbackHud.scoreValue1', { value1: pitchScore ?? '--' })}
                </div>
              </div>
            )}
            <div className="my-1.5 hidden h-px w-full bg-white/20 sm:block" aria-hidden="true" />
          </div>
          <div className="hidden sm:block">
            <SettingsInfo
              guideVolume={guideVolume}
              guideAvailable={guideAvailable}
              micUserEnabled={micUserEnabled}
              micName={micName}
              micMonitorUserEnabled={micMonitorUserEnabled}
              multiplayer={multiplayer}
              theme={theme}
              videoFlavor={videoFlavor}
              showShortcuts={!hasTouch}
            />
          </div>
          <TouchControls config={config} hasTouch={hasTouch} position={position} />
        </div>
      </div>

      {showPixabayCredit && (
        <p
          className={`${NOTE_BASE_CLASS} ${creditPositionClass(position, windowControls)} right-4`}
        >
          {t('playback.playbackHud.videosByPixabay')}
        </p>
      )}

      <Disclaimer
        source={transcriptSource}
        position={position}
        noStems={!guideAvailable}
        micActive={micUserEnabled}
      />
    </>
  );
}

export const PlaybackHud = memo(PlaybackHudImpl);
