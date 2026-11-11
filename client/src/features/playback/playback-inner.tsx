/**
 * Playback session: audio engine, visual background, lyrics HUD, and pause overlay.
 * Route shell (`Playback`) keys this session so state resets for every queued entry.
 *
 * `PlaybackInner` itself is the provider shell; `PlaybackLayout` is the
 * presentational tree that consumes the playback contexts via hooks.
 */

import { useCallback, useState } from 'react';

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
  type PlaybackTheme,
} from '@/features/playback/components/theme';
import { usePlaybackInput, usePlaybackResult } from '@/features/playback/hooks';
import { usePlaybackConfigPersist } from '@/features/playback/hooks/use-playback-config-persist';
import { usePlaybackRemote } from '@/features/playback/hooks/use-playback-remote';
import {
  usePlaybackRemoteControls,
  usePlaybackRemotePublisher,
} from '@/features/playback/hooks/use-playback-remote-controls';
import {
  useRoomPlayback,
  type RoomPlaybackSync,
} from '@/features/playback/hooks/use-room-playback';
import { playbackActions, playbackExitLabelKey } from '@/features/playback/lib/playback-actions';
import type { PlaybackAction } from '@/features/playback/lib/playback-actions';
import { FLAVORS, videoFlavorLabel, type VideoFlavor } from '@/features/playback/lib/video-flavor';
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
import { markPlaybackExit } from '@/features/rooms/lib/playback-launch';
import { roomReturnState } from '@/features/rooms/lib/room-return';
import { t, type TranslationKey } from '@/i18n';
import type { AppConfig } from '@/types/AppConfig';
import type { RoomPlayback } from '@/types/RoomPlayback';
import type { Song } from '@/types/Song';
import type { Segment } from '@/types/Transcript';

type RemoteControlDeps = {
  duration: number;
  handleToggleMic: () => void;
  handleToggleMicMonitor: () => void;
  micSelect: (deviceId: string) => void;
  persistGuideVolume: (volume: number) => void;
  seek: (time: number) => void;
  selectFlavor: (key: string) => void;
  selectTheme: (key: string) => void;
  setGuideVolume: (volume: number) => void;
  skipIntro: () => void;
  skipOutro: () => void;
};

/** Handlers are already room-aware, so the phone follows the same rules. */
const runRemoteControl = (control: PlaybackControl, deps: RemoteControlDeps): void => {
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

type PlaybackIntentInput = {
  inRoom: boolean;
  isHost: boolean;
  canResume: boolean;
  roomSync: RoomPlaybackSync;
  handlePause: () => void;
  handleContinue: () => void;
  seek: (time: number) => void;
  handleSkipIntro: () => void;
  handleSkipOutro: () => void;
};

/** Room playback routes transport intents through the node instead of locally. */
function usePlaybackIntents({
  inRoom,
  isHost,
  canResume,
  roomSync,
  handlePause,
  handleContinue,
  seek,
  handleSkipIntro,
  handleSkipOutro,
}: PlaybackIntentInput) {
  const pause = useCallback(() => {
    if (inRoom) {
      roomSync.requestPause();

      return;
    }
    handlePause();
  }, [handlePause, inRoom, roomSync]);

  const resume = useCallback(() => {
    if (!inRoom) {
      handleContinue();

      return;
    }
    if (canResume) {
      roomSync.requestResume();
    }
  }, [canResume, handleContinue, inRoom, roomSync]);

  const seekTo = useCallback(
    (time: number) => {
      if (!inRoom) {
        seek(time);

        return;
      }
      if (isHost) {
        roomSync.requestSeek(time);
      }
    },
    [inRoom, isHost, roomSync, seek],
  );

  const skipIntro = useCallback(() => {
    if (!inRoom) {
      handleSkipIntro();

      return;
    }
    if (isHost) {
      roomSync.requestSkip('intro');
    }
  }, [handleSkipIntro, inRoom, isHost, roomSync]);

  const skipOutro = useCallback(() => {
    if (!inRoom) {
      handleSkipOutro();

      return;
    }
    if (isHost) {
      roomSync.requestSkip('outro');
    }
  }, [handleSkipOutro, inRoom, isHost, roomSync]);

  return { pause, resume, seekTo, skipIntro, skipOutro };
}

function otherPauserName(room: RoomPlayback | undefined, sync: RoomPlaybackSync): string | null {
  if (room === undefined || sync.pausedById === null || sync.pausedById === room.memberId) {
    return null;
  }

  return sync.pausedByName;
}

type PlaybackCommandDeps = {
  pause: () => void;
  resume: () => void;
  next: () => void;
  exit: () => void;
};

function runPlaybackCommand(command: PlaybackCommand, deps: PlaybackCommandDeps): void {
  switch (command) {
    case 'pause':
      deps.pause();
      return;
    case 'resume':
      deps.resume();
      return;
    case 'next':
      deps.next();
      return;
    case 'exit':
      deps.exit();
  }
}

type ProgressInput = {
  paused: boolean;
  playing: boolean;
  finished: boolean;
  hasNext: boolean;
  sessionPlayback: boolean;
  position: number;
  duration: number;
  segments: Segment[];
  firstSegmentStart: number;
  introSkipLeadSec: number;
  lastSegmentEnd: number;
};

/** The phone mirrors this snapshot; the position is read live from the clock. */
function buildProgress(input: ProgressInput): PlaybackProgress {
  const position = Math.max(0, input.position);
  const line = input.segments.length > 0 ? findCurrentSegment(input.segments, position, 0) : -1;

  return {
    active: true,
    playing: input.playing,
    paused: input.paused,
    finished: input.finished,
    hasNext: input.hasNext,
    sessionPlayback: input.sessionPlayback,
    positionMs: Math.round(position * 1000),
    durationMs: Math.round(input.duration * 1000),
    skipIntro: position < input.firstSegmentStart - input.introSkipLeadSec,
    skipOutro: !input.finished && position > input.lastSegmentEnd + 1,
    previousLineMs: line > 0 ? Math.round(input.segments[line - 1].start * 1000) : null,
    nextLineMs:
      line >= 0 && line < input.segments.length - 1
        ? Math.round(input.segments[line + 1].start * 1000)
        : null,
  };
}

function hudPositionFor(lyricsVerticalPosition: string): 'top' | 'bottom' {
  return lyricsVerticalPosition === 'top' ? 'bottom' : 'top';
}

function roomActions(
  status: PlaybackStatus,
  canResume: boolean,
  exitLabel: TranslationKey,
): PlaybackAction[] {
  return playbackActions(status)
    .filter((action) => action.command !== 'resume' || canResume)
    .map((action) =>
      action.command === 'exit' ? Object.assign({}, action, { labelKey: exitLabel }) : action,
    );
}

function exitKeyFor(inRoom: boolean, status: PlaybackStatus): TranslationKey {
  return inRoom ? 'playback.actions.backToRoom' : playbackExitLabelKey(status);
}

function waitOnLoadingScreen(started: boolean, inRoom: boolean, roomStarted: boolean): boolean {
  return !started || (inRoom && !roomStarted);
}

function roomLoadingCounts(
  inRoom: boolean,
  loaded: number,
  total: number,
): { loaded: number; total: number } {
  return inRoom ? { loaded, total } : { loaded: 0, total: 0 };
}

/** One-way latch: the loading screen must never return after the song started. */
function useRoomStarted(playing: boolean): boolean {
  const [started, setStarted] = useState(false);

  if (playing && !started) {
    setStarted(true);
  }

  return started;
}

function themeOptions(
  themes: readonly PlaybackTheme[],
  videoFlavor: VideoFlavor,
): PlaybackOptions['themes'] {
  return themes.map((candidate) => ({
    key: themeKey(candidate),
    label:
      candidate.kind === 'pixabay'
        ? t('playback.theme.pixabayVideo')
        : themeName(candidate, videoFlavor),
  }));
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
    startPlaybackAt,
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
  // the surface until the node says everyone finished loading, then schedules
  // the shared start on the audio clock.
  const roomSync = useRoomPlayback(
    room ?? null,
    {
      getCurrentTime,
      handlePause,
      startAt: startPlaybackAt,
    },
    {
      score: mic.rawScore,
      series: mic.series,
      loaded: started,
      introTargetSec: Math.max(0, transcript.firstSegmentStart - transcript.introSkipLeadSec),
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
  const hudPosition = hudPositionFor(lyricsVerticalPosition);
  const sessionWindowControls = sessionPlayback && isTauri;

  // A room keeps the seat: leaving playback returns to the room, not the menu.
  const exitPlayback = useCallback(() => {
    if (room === undefined) {
      handleExit();
      return;
    }

    // Leaving mid-song must not reopen this track's surface on the way up.
    if (roomSync.playing) {
      markPlaybackExit(song.file_hash);

      // The host leaving ends the song for everyone instead of stalling the room.
      if (roomSync.isHost) {
        roomSync.requestSkip('outro');
      }
    }

    handleExit({
      path: '/rooms',
      state: roomReturnState({
        nodeUrl: room.nodeUrl,
        joining: { roomId: room.roomId, memberId: room.memberId, token: room.token },
      }),
    });
  }, [handleExit, room, roomSync, song.file_hash]);

  const result = usePlaybackResult(song, queuePlayback, players ?? [], exitPlayback);

  const inRoom = room !== undefined;
  const canControl = !inRoom || roomSync.isHost;
  const canResume = !inRoom || roomSync.pausedById === room.memberId;
  // The loading screen stays until the room's shared start, then never returns.
  const roomStarted = useRoomStarted(roomSync.playing);
  const showLoading = waitOnLoadingScreen(started, inRoom, roomStarted);
  const roomCounts = roomLoadingCounts(inRoom, roomSync.loaded, roomSync.total);
  const { pause, resume, seekTo, skipIntro, skipOutro } = usePlaybackIntents({
    inRoom,
    isHost: roomSync.isHost,
    canResume,
    roomSync,
    handlePause,
    handleContinue,
    seek,
    handleSkipIntro: transcriptActions.handleSkipIntro,
    handleSkipOutro: transcriptActions.handleSkipOutro,
  });

  usePlaybackInput(config, !result.open, { pause, resume, skipIntro, skipOutro });

  // One state object feeds the host modals and the phone remote, so both offer
  // exactly the same actions.
  const status: PlaybackStatus = {
    active: true,
    paused,
    finished: result.open,
    hasNext: result.onNext !== undefined,
    sessionPlayback,
  };
  const exitLabelKey: TranslationKey = exitKeyFor(inRoom, status);
  const actions = roomActions(status, canResume, exitLabelKey);
  const runCommand = useCallback(
    (command: PlaybackCommand) =>
      runPlaybackCommand(command, {
        pause,
        resume,
        next: () => result.onNext?.(),
        exit: exitPlayback,
      }),
    [exitPlayback, pause, result, resume],
  );

  usePlaybackRemote(status, {
    pause,
    resume,
    next: () => result.onNext?.(),
    exit: exitPlayback,
  });

  // The phone mirrors this snapshot: position and time-derived skip flags are
  // read live, everything else follows the host providers directly.
  const readProgress = (): PlaybackProgress =>
    buildProgress({
      paused,
      playing: isPlaying,
      finished: result.open,
      hasNext: result.onNext !== undefined,
      sessionPlayback,
      position: getCurrentTime(),
      duration,
      segments,
      firstSegmentStart: transcript.firstSegmentStart,
      introSkipLeadSec: transcript.introSkipLeadSec,
      lastSegmentEnd: transcript.lastSegmentEnd,
    });

  const remoteOptions: PlaybackOptions = {
    guideVolume,
    guideAvailable,
    multiplayer: mic.multiplayer,
    micEnabled: mic.micUserEnabled,
    micMonitorEnabled: mic.micMonitorUserEnabled,
    selectedMicId: mic.selectedMicId,
    microphones: mic.devices.map(({ deviceId, label }) => ({ deviceId, label })),
    themes: themeOptions(themes, videoFlavor),
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
      seek: seekTo,
      selectFlavor: themeActions.selectFlavor,
      selectTheme: themeActions.selectTheme,
      setGuideVolume,
      skipIntro,
      skipOutro,
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
        seekable={canControl}
        canSkip={canControl}
        onPause={pause}
        onSeek={seekTo}
        onSkipIntro={skipIntro}
        onSkipOutro={skipOutro}
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

      {showLoading && (
        <LoadingScreen song={song} roomLoaded={roomCounts.loaded} roomTotal={roomCounts.total} />
      )}

      <PauseOverlay
        open={paused && !result.open}
        actions={actions}
        onCommand={runCommand}
        canResume={canResume}
        pausedBy={otherPauserName(room, roomSync)}
      />

      <ResultDialog
        open={result.open}
        results={result.results}
        song={song}
        scores={result.scores}
        nextPending={result.nextPending}
        exitLabel={t(exitLabelKey)}
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
    <PlaybackProviders
      song={song}
      config={config}
      players={players}
      deferStart={room !== undefined}
    >
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
