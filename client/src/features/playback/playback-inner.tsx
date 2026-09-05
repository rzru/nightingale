/**
 * Playback session: audio engine, visual background, lyrics HUD, and pause overlay.
 * Route shell (`Playback`) keys this session so state resets for every queued entry.
 *
 * `PlaybackInner` itself is the provider shell; `PlaybackLayout` is the
 * presentational tree that consumes the playback contexts via hooks.
 */

import { useState } from 'react';

import { isTauri } from '@/bridge/runtime';
import { Background } from '@/features/playback/components/background';
import { ResultDialog } from '@/features/playback/components/dialogs/result';
import { LyricsDisplay } from '@/features/playback/components/lyrics-display';
import { PauseOverlay } from '@/features/playback/components/pause-overlay';
import { PitchGraph } from '@/features/playback/components/pitch-graph';
import { PlaybackHud } from '@/features/playback/components/playback-hud';
import { RecordingControls } from '@/features/playback/components/recording-controls';
import { usePlaybackInput, usePlaybackResult } from '@/features/playback/hooks';
import {
  PlaybackProviders,
  usePlaybackMicState,
  usePlaybackTranscriptState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import type { AppConfig } from '@/types/AppConfig';
import type { Song } from '@/types/Song';

export type PlaybackInnerProps = {
  song: Song;
  config: AppConfig | null;
  queuePlayback: boolean;
  sessionPlayback: boolean;
};

type PlaybackLayoutProps = PlaybackInnerProps;

function displaySettings(config: AppConfig | null) {
  return {
    lyricsVerticalPosition: config?.lyrics_vertical_position ?? 'bottom',
    lyricsHorizontalPosition: config?.lyrics_horizontal_position ?? 'center',
    lyricsScale: config?.lyrics_scale,
    pitchGraphScale: config?.pitch_graph_scale,
  };
}

function PlaybackLayout({ song, config, queuePlayback, sessionPlayback }: PlaybackLayoutProps) {
  const [recordingActive, setRecordingActive] = useState(false);
  const { isReady, paused } = usePlaybackTransportState();
  const { handleContinue, handleExit } = usePlaybackTransportActions();
  const { segments } = usePlaybackTranscriptState();
  const { series } = usePlaybackMicState();
  const { lyricsVerticalPosition, lyricsHorizontalPosition, lyricsScale, pitchGraphScale } =
    displaySettings(config);
  const hudPosition = lyricsVerticalPosition === 'top' ? 'bottom' : 'top';
  const sessionWindowControls = sessionPlayback && isTauri;

  usePlaybackInput(config);
  const result = usePlaybackResult(song, queuePlayback);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black" style={{ contain: 'strict' }}>
      <Background />

      {isReady && (
        <>
          <PlaybackHud
            title={song.title}
            artist={song.artist}
            config={config}
            position={hudPosition}
            windowControls={sessionWindowControls}
            recordingActive={recordingActive}
          />
          <PitchGraph
            series={series}
            position={hudPosition}
            scale={pitchGraphScale}
            recordingActive={recordingActive}
          />
          <LyricsDisplay
            segments={segments}
            verticalPosition={lyricsVerticalPosition}
            horizontalPosition={lyricsHorizontalPosition}
            scale={lyricsScale}
            recordingActive={recordingActive}
          />
          <RecordingControls
            song={song}
            recordingsPath={config?.recordings_path ?? null}
            onActiveChange={setRecordingActive}
          />
        </>
      )}

      <PauseOverlay
        open={paused && !result.open}
        exitLabel={sessionPlayback ? 'Exit Playback' : 'Exit to Menu'}
        onContinue={handleContinue}
        onExit={handleExit}
      />

      <ResultDialog
        open={result.open}
        score={result.score}
        song={song}
        scores={result.scores}
        activeProfile={result.activeProfile}
        nextPending={result.nextPending}
        exitLabel={sessionPlayback ? 'Exit Playback' : 'Back to Menu'}
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
}: PlaybackInnerProps) {
  return (
    <PlaybackProviders song={song} config={config}>
      <PlaybackLayout
        song={song}
        config={config}
        queuePlayback={queuePlayback}
        sessionPlayback={sessionPlayback}
      />
    </PlaybackProviders>
  );
}
