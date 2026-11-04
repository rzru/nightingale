/**
 * Playback session: audio engine, visual background, lyrics HUD, and pause overlay.
 * Route shell (`Playback`) keys this session so state resets for every queued entry.
 *
 * `PlaybackInner` itself is the provider shell; `PlaybackLayout` is the
 * presentational tree that consumes the playback contexts via hooks.
 */

import { useCallback } from 'react';

import type { PlaybackOptions, PlaybackProgress } from '@/bridge/playback-remote';
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
import type { Song } from '@/types/Song';

export type PlaybackInnerProps = {
  song: Song;
  config: AppConfig | null;
  queuePlayback: boolean;
  sessionPlayback: boolean;
  players?: readonly PlaybackPlayer[];
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
}: PlaybackLayoutProps) {
  const { paused, isPlaying, duration, guideVolume, guideAvailable } = usePlaybackTransportState();
  const {
    getCurrentTime,
    subscribe,
    seek,
    setGuideVolume,
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
          handlePause();
          return;
        case 'resume':
          handleContinue();
          return;
        case 'next':
          result.onNext?.();
          return;
        case 'exit':
          handleExit();
      }
    },
    [handleContinue, handleExit, handlePause, result],
  );

  usePlaybackRemote(status, {
    pause: handlePause,
    resume: handleContinue,
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

  usePlaybackRemoteControls((control) => {
    switch (control.type) {
      case 'seek':
        seek(Math.max(0, Math.min(duration, control.positionMs / 1000)));
        return;
      case 'skip-intro':
        transcriptActions.handleSkipIntro();
        return;
      case 'skip-outro':
        transcriptActions.handleSkipOutro();
        return;
      case 'set-guide-volume': {
        const volume = Math.max(0, Math.min(1, control.volume));
        setGuideVolume(volume);
        persistConfig({ guide_volume: volume });
        return;
      }
      case 'toggle-mic':
        micActions.handleToggleMic();
        return;
      case 'select-mic':
        micActions.selectMic(control.deviceId);
        return;
      case 'toggle-monitoring':
        micActions.handleToggleMicMonitor();
        return;
      case 'select-theme':
        themeActions.selectTheme(control.key);
        return;
      case 'select-flavor':
        themeActions.selectFlavor(control.key);
        return;
    }
  });

  return (
    <div className="fixed inset-0 overflow-hidden bg-black" style={{ contain: 'strict' }}>
      <Background />
      <PlaybackHud
        title={song.title}
        artist={song.artist}
        config={config}
        position={hudPosition}
        windowControls={sessionWindowControls}
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
}: PlaybackInnerProps) {
  return (
    <PlaybackProviders song={song} config={config} players={players}>
      <PlaybackLayout
        song={song}
        config={config}
        queuePlayback={queuePlayback}
        sessionPlayback={sessionPlayback}
        players={players}
      />
    </PlaybackProviders>
  );
}
