/**
 * Playback session: audio engine, visual background, lyrics HUD, and pause overlay.
 * Route shell (`Playback`) keys this session so state resets for every queued entry.
 *
 * `PlaybackInner` itself is the provider shell; `PlaybackLayout` is the
 * presentational tree that consumes the playback contexts via hooks.
 */

import { useCallback } from 'react';

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
import { isPitchGuideTheme } from '@/features/playback/components/theme';
import { usePlaybackInput, usePlaybackResult } from '@/features/playback/hooks';
import { usePlaybackRemote } from '@/features/playback/hooks/use-playback-remote';
import { playbackActions, playbackExitLabelKey } from '@/features/playback/lib/playback-actions';
import {
  PlaybackProviders,
  usePlaybackMicState,
  usePlaybackThemeState,
  usePlaybackTranscriptState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import { usePlaybackStartupState } from '@/features/playback/providers/playback-startup-context';
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
  const { paused } = usePlaybackTransportState();
  const { handlePause, handleContinue, handleExit } = usePlaybackTransportActions();
  const { segments } = usePlaybackTranscriptState();
  const { started } = usePlaybackStartupState();
  const { theme } = usePlaybackThemeState();
  const mic = usePlaybackMicState();
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
