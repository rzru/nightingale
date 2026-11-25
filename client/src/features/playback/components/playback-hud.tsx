import {
  ChevronDownIcon,
  EarIcon,
  ImageIcon,
  MicIcon,
  SlidersHorizontalIcon,
  VideoIcon,
} from 'lucide-react';
import { forwardRef, memo, useEffect, useRef, useState, type ReactNode } from 'react';

import type { MicDevice } from '@/features/microphone/queries/use-mic-devices';
import { usePlaybackConfigPersist } from '@/features/playback/hooks/use-playback-config-persist';
import { FLAVORS, videoFlavorLabel, type VideoFlavor } from '@/features/playback/lib/video-flavor';
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
import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { playerColorOption } from '@/shared/player-colors';
import { cn } from '@/shared/utils/cn';
import type { AppConfig } from '@/types/AppConfig';

import { LiveStars } from './live-stars';
import { HudSetting, HudSettingValue, ShortcutKeys } from './playback-hud-setting';
import { PlaybackTransportControls } from './playback-transport-controls';
import { PlaybackVolumeControl } from './playback-volume-control';
import { isPixabayTheme, themeKey, themeName, type PlaybackTheme } from './theme';

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

const NOTE_BASE_CLASS = `pointer-events-none absolute z-20 text-[0.6rem] text-white/30`;
const HUD_SELECT_CLASS =
  'w-full border-white/25 bg-white/10 text-white/80 hover:bg-white/15 [&_svg]:text-white/50';
const OFF_MIC = 'off';
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

function MicSetting({
  devices,
  selected,
  summary,
  expanded,
  onSelect,
  shortcut,
}: {
  devices: readonly MicDevice[];
  selected: string | undefined;
  summary: string;
  expanded: boolean;
  onSelect: (value: string) => void;
  shortcut?: ReactNode;
}) {
  return (
    <HudSetting
      icon={MicIcon}
      label={t('settings.microphone.label')}
      shortcut={shortcut}
      compact={!expanded}
    >
      {expanded ? (
        <Select value={selected} onValueChange={onSelect}>
          <SelectTrigger
            size="sm"
            aria-label={t('settings.microphone.label')}
            className={HUD_SELECT_CLASS}
          >
            <SelectValue placeholder={t('settings.microphone.default')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OFF_MIC}>{t('common.states.off')}</SelectItem>
            {devices.map((device) => (
              <SelectItem key={device.deviceId} value={device.deviceId}>
                {device.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <HudSettingValue>{summary}</HudSettingValue>
      )}
    </HudSetting>
  );
}

function MonitorSetting({
  enabled,
  expanded,
  onToggle,
  shortcut,
}: {
  enabled: boolean;
  expanded: boolean;
  onToggle: () => void;
  shortcut?: ReactNode;
}) {
  const summary = t(enabled ? 'common.states.on' : 'common.states.off');

  return (
    <HudSetting
      icon={EarIcon}
      label={t('playback.hud.monitor')}
      trailing={
        expanded ? (
          <Checkbox
            checked={enabled}
            onCheckedChange={onToggle}
            aria-label={t('playback.hud.monitor')}
            className="border-white/40 data-checked:border-white data-checked:bg-white/15 data-checked:text-white dark:data-checked:bg-white/15"
          />
        ) : (
          <HudSettingValue>{summary}</HudSettingValue>
        )
      }
      shortcut={shortcut}
    />
  );
}

function ThemeSetting({
  themes,
  theme,
  videoFlavor,
  expanded,
  onSelect,
  onSelectFlavor,
  shortcut,
  showShortcuts,
}: {
  themes: readonly PlaybackTheme[];
  theme: PlaybackTheme;
  videoFlavor: VideoFlavor;
  expanded: boolean;
  onSelect: (key: string) => void;
  onSelectFlavor: (key: string) => void;
  shortcut?: ReactNode;
  showShortcuts: boolean;
}) {
  return (
    <>
      <HudSetting
        icon={ImageIcon}
        label={t('playback.playbackHud.theme')}
        trailing={
          expanded ? undefined : <HudSettingValue>{themeName(theme, videoFlavor)}</HudSettingValue>
        }
        shortcut={shortcut}
      >
        {expanded && (
          <Select value={themeKey(theme)} onValueChange={onSelect}>
            <SelectTrigger
              size="sm"
              aria-label={t('playback.playbackHud.theme')}
              className={HUD_SELECT_CLASS}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {themes.map((option) => (
                <SelectItem key={themeKey(option)} value={themeKey(option)}>
                  {themeName(option, videoFlavor)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </HudSetting>

      {expanded && isPixabayTheme(theme) && (
        <FlavorSetting
          flavor={videoFlavor}
          onSelect={onSelectFlavor}
          shortcut={showShortcuts ? <ShortcutKeys keys={['F']} /> : undefined}
        />
      )}
    </>
  );
}

function FlavorSetting({
  flavor,
  onSelect,
  shortcut,
}: {
  flavor: VideoFlavor;
  onSelect: (key: string) => void;
  shortcut?: ReactNode;
}) {
  return (
    <HudSetting icon={VideoIcon} label={t('playback.playbackHud.flavor')} shortcut={shortcut}>
      <Select value={flavor} onValueChange={onSelect}>
        <SelectTrigger
          size="sm"
          aria-label={t('playback.playbackHud.flavor')}
          className={HUD_SELECT_CLASS}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FLAVORS.map((option) => (
            <SelectItem key={option} value={option}>
              {videoFlavorLabel(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </HudSetting>
  );
}

function SettingsInfo({
  devices,
  selectedMicId,
  micUserEnabled,
  micName,
  micMonitorUserEnabled,
  multiplayer,
  themes,
  theme,
  videoFlavor,
  showShortcuts,
  expanded,
}: {
  devices: readonly MicDevice[];
  selectedMicId: string | null;
  micUserEnabled: boolean;
  micName: string;
  micMonitorUserEnabled: boolean;
  multiplayer: boolean;
  themes: readonly PlaybackTheme[];
  theme: PlaybackTheme;
  videoFlavor: VideoFlavor;
  showShortcuts: boolean;
  expanded: boolean;
}) {
  const { handleToggleMic, handleToggleMicMonitor, selectMic } = usePlaybackMicActions();
  const { selectFlavor, selectTheme } = usePlaybackThemeActions();

  const changeMic = (value: string) => {
    if (value !== OFF_MIC) {
      if (!micUserEnabled) {
        handleToggleMic();
      }
      selectMic(value);
      return;
    }
    if (micUserEnabled) {
      handleToggleMic();
    }
  };

  return (
    <>
      {!multiplayer && (
        <MicSetting
          devices={devices}
          selected={micUserEnabled ? (selectedMicId ?? undefined) : OFF_MIC}
          summary={micUserEnabled ? micName : t('common.states.off')}
          expanded={expanded}
          onSelect={changeMic}
          shortcut={showShortcuts ? <ShortcutKeys keys={['M', 'N']} /> : undefined}
        />
      )}

      <MonitorSetting
        enabled={micMonitorUserEnabled}
        expanded={expanded}
        onToggle={handleToggleMicMonitor}
        shortcut={showShortcuts ? <ShortcutKeys keys={['R']} /> : undefined}
      />

      <ThemeSetting
        themes={themes}
        theme={theme}
        videoFlavor={videoFlavor}
        expanded={expanded}
        onSelect={selectTheme}
        onSelectFlavor={selectFlavor}
        shortcut={showShortcuts ? <ShortcutKeys keys={['T']} /> : undefined}
        showShortcuts={showShortcuts}
      />
    </>
  );
}

const SETTINGS_VIEWS = ['collapsed', 'expanded', 'hidden'] as const;
type SettingsView = (typeof SETTINGS_VIEWS)[number];

function parseSettingsView(value: string | null | undefined): SettingsView {
  return SETTINGS_VIEWS.find((view) => view === value) ?? 'collapsed';
}

function nextSettingsView(view: SettingsView): SettingsView {
  return SETTINGS_VIEWS[(SETTINGS_VIEWS.indexOf(view) + 1) % SETTINGS_VIEWS.length];
}

function settingsWidthClass(showShortcuts: boolean): string {
  return showShortcuts ? 'w-72' : 'w-56';
}

function SettingsToggle({ view, onToggle }: { view: SettingsView; onToggle: () => void }) {
  const expanded = view === 'expanded';

  return (
    <button
      type="button"
      aria-expanded={expanded}
      title={t('playback.hud.settings')}
      onClick={onToggle}
      className={cn(
        'flex items-center gap-1 self-end text-xs text-white/40 transition-colors hover:text-white/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f3ead7]',
        view !== 'hidden' && 'mt-1',
      )}
    >
      {t('playback.hud.settings')}
      {view === 'hidden' ? (
        <SlidersHorizontalIcon className="size-3.5" aria-hidden="true" />
      ) : (
        <ChevronDownIcon
          className={cn('size-3.5 transition-transform', expanded && 'rotate-180')}
          aria-hidden="true"
        />
      )}
    </button>
  );
}

function HudSettings({
  config,
  showShortcuts,
}: {
  config: AppConfig | null;
  showShortcuts: boolean;
}) {
  const view = parseSettingsView(config?.playback_hud_view);
  const persistConfig = usePlaybackConfigPersist(config);
  const { devices, selectedMicId, micUserEnabled, micName, micMonitorUserEnabled, multiplayer } =
    usePlaybackMicState();
  const { theme, themes, videoFlavor } = usePlaybackThemeState();

  return (
    <div className="mt-2 hidden flex-col sm:flex">
      {view !== 'hidden' && (
        <div
          className={cn(
            'flex flex-col',
            settingsWidthClass(showShortcuts),
            view === 'expanded' ? 'gap-2' : 'gap-1',
          )}
        >
          <PlaybackVolumeControl
            config={config}
            showShortcuts={showShortcuts}
            expanded={view === 'expanded'}
          />
          <SettingsInfo
            devices={devices}
            selectedMicId={selectedMicId}
            micUserEnabled={micUserEnabled}
            micName={micName}
            micMonitorUserEnabled={micMonitorUserEnabled}
            multiplayer={multiplayer}
            themes={themes}
            theme={theme}
            videoFlavor={videoFlavor}
            showShortcuts={showShortcuts}
            expanded={view === 'expanded'}
          />
        </div>
      )}
      <SettingsToggle
        view={view}
        onToggle={() => persistConfig({ playback_hud_view: nextSettingsView(view) })}
      />
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
  const { duration, guideAvailable, paused } = usePlaybackTransportState();
  const { subscribe, getCurrentTime, handlePause, handleContinue } = usePlaybackTransportActions();
  const { theme, themes, videoFlavor } = usePlaybackThemeState();
  const { firstSegmentStart, lastSegmentEnd, introSkipLeadSec, segments, transcriptSource } =
    usePlaybackTranscriptState();
  const { handleSkipIntro, handleSkipOutro } = usePlaybackTranscriptActions();
  const {
    devices,
    selectedMicId,
    pitchScore,
    micUserEnabled,
    micName,
    micMonitorUserEnabled,
    multiplayer,
    players,
  } = usePlaybackMicState();

  const skipIntroRef = useRef<HTMLButtonElement>(null);
  const skipOutroRef = useRef<HTMLButtonElement>(null);
  const gapCaptionRef = useRef<HTMLOutputElement>(null);
  const gapHintRef = useRef(0);

  const showPixabayCredit = isPixabayTheme(theme);
  const hasTouch = useHasTouchInput();
  const showShortcuts = !hasTouch;

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
          <PlaybackTransportControls
            duration={duration}
            segments={segments}
            paused={paused}
            onTogglePlay={paused ? handleContinue : handlePause}
          />
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
                <div className={scoreTextClass(pitchScore)}>{pitchScore ?? '--'}</div>
              </div>
            )}
            <div className="my-1.5 hidden h-px w-full bg-white/20 sm:block" aria-hidden="true" />
          </div>
          <HudSettings config={config} showShortcuts={showShortcuts} />
          <div className="mt-2 flex w-[min(14rem,80vw)] flex-col gap-2 sm:hidden">
            <PlaybackVolumeControl config={config} showShortcuts={false} expanded />
            <SettingsInfo
              devices={devices}
              selectedMicId={selectedMicId}
              micUserEnabled={micUserEnabled}
              micName={micName}
              micMonitorUserEnabled={micMonitorUserEnabled}
              multiplayer={multiplayer}
              themes={themes}
              theme={theme}
              videoFlavor={videoFlavor}
              showShortcuts={false}
              expanded
            />
          </div>
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
