/**
 * Playback session: audio engine, visual background, lyrics HUD, and pause overlay.
 * Route shell (`Playback`) keys this session so state resets for every queued entry.
 *
 * `PlaybackInner` itself is the provider shell; `PlaybackLayout` is the
 * presentational tree that consumes the playback contexts via hooks.
 */

import { useCallback } from 'react';

import type { PlaybackControl, PlaybackOptions, PlaybackProgress } from '@/bridge/playback-remote';
import type { PlaybackPlayer } from '@/bridge/playback-session';
import type { PlaybackCommand, PlaybackStatus } from '@/bridge/playback-status';
import { isTauri } from '@/bridge/runtime';
import { Background } from '@/features/playback/components/background';
import { ResultDialog } from '@/features/playback/components/dialogs/result';
import { LoadingScreen } from '@/features/playback/components/loading-screen';
import { LyricsDisplay } from '@/features/playback/components/lyrics-display';
import { PauseOverlay } from '@/features/playback/components/pause-overlay';
import { PitchGraph } from '@/features/playback/components/pitch-graph';
import { PlaybackHud } from '@/features/playback/components/playback-hud';
import {
  isPitchGuideTheme,
  isPixabayTheme,
  themeKey,
  themeName,
} from '@/features/playback/components/theme';
import { usePlaybackInput, usePlaybackResult } from '@/features/playback/hooks';
import { usePlaybackConfigPersist } from '@/features/playback/hooks/use-playback-config-persist';
import { usePlaybackRemote } from '@/features/playback/hooks/use-playback-remote';
import {
  usePlaybackRemoteControls,
  usePlaybackRemotePublisher,
} from '@/features/playback/hooks/use-playback-remote-controls';
import { useRoomPlayback } from '@/features/playback/hooks/use-room-playback';
import { playbackActions, playbackExitLabelKey } from '@/features/playback/lib/playback-actions';
import { FLAVORS, videoFlavorLabel } from '@/features/playback/lib/video-flavor';
import {
  PlaybackProviders,
  usePlaybackMicActions,
  usePlaybackMicState,
  usePlaybackThemeActions,
  usePlaybackThemeState,
  usePlaybackTranscriptActions,
  usePlaybackTranscriptState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import { usePlaybackStartupState } from '@/features/playback/providers/playback-startup-context';
import { findCurrentSegment } from '@/features/playback/utils/lyrics-gap';
import { t } from '@/i18n';
import type { AppConfig } from '@/types/AppConfig';
import type { RoomPlayback } from '@/types/RoomPlayback';
import type { Song } from '@/types/Song';

type RemoteControlDeps = {
  duration: number;
  handleToggleMic: () => void;
  handleToggleMicMonitor: () => void;
  micSelect: (deviceId: string) => void;
  persistGuideVolume: (volume: number) => void;
  room: RoomPlayback | undefined;
  roomSkip: (kind: 'intro' | 'outro') => void;
  seek: (time: number) => void;
  selectFlavor: (key: string) => void;
  selectTheme: (key: string) => void;
  setGuideVolume: (volume: number) => void;
  skipIntro: () => void;
  skipOutro: () => void;
};

/** In a room the clock owns the position: seeking is refused and skips broadcast. */
const handleRoomControl = (control: PlaybackControl, deps: RemoteControlDeps): boolean => {
  if (deps.room === undefined) {
    return false;
  }

  if (control.type === 'seek') {
    return true;
  }

  if (control.type === 'skip-intro' || control.type === 'skip-outro') {
    deps.roomSkip(control.type === 'skip-intro' ? 'intro' : 'outro');

    return true;
  }

  return false;
};

const runSoloControl = (control: PlaybackControl, deps: RemoteControlDeps): void => {
  switch (control.type) {
    case 'seek':
      deps.seek(Math.max(0, Math.min(deps.duration, control.positionMs / 1000)));
      return;
    case 'set-guide-volume': {
      const volume = Math.max(0, Math.min(1, control.volume));
      deps.setGuideVolume(volume);
      deps.persistGuideVolume(volume);
      return;
    }
    case 'toggle-mic':
      deps.handleToggleMic();
      return;
    case 'select-mic':
      deps.micSelect(control.deviceId);
      return;
    case 'toggle-monitoring':
      deps.handleToggleMicMonitor();
      return;
    case 'select-theme':
      deps.selectTheme(control.key);
      return;
    case 'select-flavor':
      deps.selectFlavor(control.key);
      return;
    case 'skip-intro':
      deps.skipIntro();
      return;
    case 'skip-outro':
      deps.skipOutro();
      return;
  }
};

const runRemoteControl = (control: PlaybackControl, deps: RemoteControlDeps): void => {
  if (!handleRoomControl(control, deps)) {
    runSoloControl(control, deps);
  }
};

export type PlaybackInnerProps = {
  song: Song;
  config: AppConfig | null;
  queuePlayback: boolean;
  sessionPlayback: boolean;
  players?: readonly PlaybackPlayer[];
  /** Set only for room playback; `undefined` keeps the solo path untouched. */
  room?: RoomPlayback;
};

type PlaybackLayoutProps = PlaybackInnerProps;

function displaySettings(config: AppConfig | null) {
  return {
    lyricsVerticalPosition: config?.lyrics_vertical_position ?? 'bottom',
    lyricsHorizontalPosition: config?.lyrics_horizontal_position ?? 'center',
    lyricsScale: config?.lyrics_scale,
    pitchGraphScale: config?.pitch_graph_scale,
    lyricsRomanizationMode: config?.lyrics_romanization_mode ?? 'enabled',
  };
}

function PlaybackLayout({
  song,
  config,
  queuePlayback,
  sessionPlayback,
  players,
  room,
}: PlaybackLayoutProps) {
  const { paused, isPlaying, duration, guideVolume, guideAvailable } = usePlaybackTransportState();
  const {
    getCurrentTime,
    subscribe,
    seek,
    setGuideVolume,
    pauseAudio,
    startPlayback,
    handlePause,
    handleContinue,
    handleExit,
  } = usePlaybackTransportActions();
  const transcript = usePlaybackTranscriptState();
  const { segments } = transcript;
  const transcriptActions = usePlaybackTranscriptActions();
  const { started } = usePlaybackStartupState();

  const { theme, themes, videoFlavor } = usePlaybackThemeState();
  const themeActions = usePlaybackThemeActions();
  const mic = usePlaybackMicState();
  const micActions = usePlaybackMicActions();
  // Inert for solo playback: no extra players, no socket. Room playback holds
  // the surface until the node says everyone finished loading.
  const roomSync = useRoomPlayback(
    room ?? null,
    {
      getCurrentTime,
      pauseAudio,
      resume: handleContinue,
      seek,
      startPlayback,
    },
    {
      score: mic.pitchScore,
      series: mic.series,
      loaded: started,
      skipIntro: transcriptActions.handleSkipIntro,
      skipOutro: transcriptActions.handleSkipOutro,
    },
  );
  const persistConfig = usePlaybackConfigPersist(config);
  const {
    lyricsVerticalPosition,
    lyricsHorizontalPosition,
    lyricsScale,
    pitchGraphScale,
    lyricsRomanizationMode,
  } = displaySettings(config);
  const hudPosition = lyricsVerticalPosition === 'top' ? 'bottom' : 'top';
  const sessionWindowControls = sessionPlayback && isTauri;

  const result = usePlaybackResult(song, queuePlayback, players ?? []);
  usePlaybackInput(config, !result.open);

  // One state object feeds the host modals and the phone remote, so both offer
  // exactly the same actions.
  const status: PlaybackStatus = {
    active: true,
    paused,
    finished: result.open,
    hasNext: result.onNext !== undefined,
    sessionPlayback,
  };
  const actions = playbackActions(status);
  const runCommand = useCallback(
    (command: PlaybackCommand) => {
      switch (command) {
        case 'pause':
          if (room === undefined) {
            handlePause();
          } else {
            roomSync.requestPause();
          }
          return;
        case 'resume':
          if (room === undefined) {
            handleContinue();
          } else {
            roomSync.requestResume();
          }
          return;
        case 'next':
          result.onNext?.();
          return;
        case 'exit':
          handleExit();
      }
    },
    [handleContinue, handleExit, handlePause, result, room, roomSync],
  );

  usePlaybackRemote(status, {
    pause: () => (room === undefined ? handlePause() : roomSync.requestPause()),
    resume: () => (room === undefined ? handleContinue() : roomSync.requestResume()),
    next: () => result.onNext?.(),
    exit: handleExit,
  });

  // The phone mirrors this snapshot: position and time-derived skip flags are
  // read live, everything else follows the host providers directly.
  const readProgress = (): PlaybackProgress => {
    const position = Math.max(0, getCurrentTime());
    const line = segments.length > 0 ? findCurrentSegment(segments, position, 0) : -1;

    return {
      active: true,
      playing: isPlaying,
      paused,
      finished: result.open,
      hasNext: result.onNext !== undefined,
      sessionPlayback,
      positionMs: Math.round(position * 1000),
      durationMs: Math.round(duration * 1000),
      skipIntro: position < transcript.firstSegmentStart - transcript.introSkipLeadSec,
      skipOutro: !result.open && position > transcript.lastSegmentEnd + 1,
      previousLineMs: line > 0 ? Math.round(segments[line - 1].start * 1000) : null,
      nextLineMs:
        line >= 0 && line < segments.length - 1
          ? Math.round(segments[line + 1].start * 1000)
          : null,
    };
  };

  const remoteOptions: PlaybackOptions = {
    guideVolume,
    guideAvailable,
    multiplayer: mic.multiplayer,
    micEnabled: mic.micUserEnabled,
    micMonitorEnabled: mic.micMonitorUserEnabled,
    selectedMicId: mic.selectedMicId,
    microphones: mic.devices.map(({ deviceId, label }) => ({ deviceId, label })),
    themes: themes.map((candidate) => ({
      key: themeKey(candidate),
      label:
        candidate.kind === 'pixabay'
          ? t('playback.theme.pixabayVideo')
          : themeName(candidate, videoFlavor),
    })),
    themeKey: themeKey(theme),
    flavors: FLAVORS.map((flavor) => ({ key: flavor, label: videoFlavorLabel(flavor) })),
    flavorKey: videoFlavor,
    flavorAvailable: isPixabayTheme(theme),
  };

  usePlaybackRemotePublisher(readProgress, remoteOptions, subscribe);

  usePlaybackRemoteControls((control) =>
    runRemoteControl(control, {
      duration,
      handleToggleMic: micActions.handleToggleMic,
      handleToggleMicMonitor: micActions.handleToggleMicMonitor,
      micSelect: micActions.selectMic,
      persistGuideVolume: (volume) => persistConfig({ guide_volume: volume }),
      room,
      roomSkip: roomSync.requestSkip,
      seek,
      selectFlavor: themeActions.selectFlavor,
      selectTheme: themeActions.selectTheme,
      setGuideVolume,
      skipIntro: transcriptActions.handleSkipIntro,
      skipOutro: transcriptActions.handleSkipOutro,
    }),
  );

  return (
    <div className="fixed inset-0 overflow-hidden bg-black" style={{ contain: 'strict' }}>
      <Background />
      <PlaybackHud
        title={song.title}
        artist={song.artist}
        config={config}
        position={hudPosition}
        windowControls={sessionWindowControls}
        locked={room !== undefined}
      />
      {!isPitchGuideTheme(theme) && (
        <PitchGraph series={mic.series} position={hudPosition} scale={pitchGraphScale} />
      )}
      <LyricsDisplay
        segments={segments}
        verticalPosition={lyricsVerticalPosition}
        horizontalPosition={lyricsHorizontalPosition}
        scale={lyricsScale}
        romanizationMode={lyricsRomanizationMode}
      />

      {!started && <LoadingScreen song={song} />}

      <PauseOverlay open={paused && !result.open} actions={actions} onCommand={runCommand} />

      <ResultDialog
        open={result.open}
        results={result.results}
        song={song}
        scores={result.scores}
        nextPending={result.nextPending}
        exitLabel={t(playbackExitLabelKey(status))}
        autoContinue={config?.auto_continue_queue === true}
        onAutoContinueChange={(next) => persistConfig({ auto_continue_queue: next })}
        onBack={result.onBack}
        onNext={result.onNext}
      />
    </div>
  );
}

export function PlaybackInner({
  song,
  config,
  queuePlayback,
  sessionPlayback,
  players,
  room,
}: PlaybackInnerProps) {
  return (
    <PlaybackProviders song={song} config={config} players={players}>
      <PlaybackLayout
        room={room}
        song={song}
        config={config}
        queuePlayback={queuePlayback}
        sessionPlayback={sessionPlayback}
        players={players}
      />
    </PlaybackProviders>
  );
}
