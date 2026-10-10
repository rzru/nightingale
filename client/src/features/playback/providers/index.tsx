/**
 * Composite playback provider tree. Order matters: theme/mic/transcript all
 * read from transport, and mic also needs theme indirectly via the song.
 */

import type { ReactNode } from 'react';

import type { PlaybackPlayer } from '@/bridge/playback-session';
import type { AppConfig } from '@/types/AppConfig';
import type { Song } from '@/types/Song';

import { PlaybackMicProvider } from './playback-mic-context';
import { PlaybackThemeProvider } from './playback-theme-context';
import { PlaybackTranscriptProvider } from './playback-transcript-context';
import { PlaybackTransportProvider } from './playback-transport-context';

type PlaybackProvidersProps = {
  song: Song;
  config: AppConfig | null;
  players?: readonly PlaybackPlayer[];
  children: ReactNode;
};

export function PlaybackProviders({ song, config, players, children }: PlaybackProvidersProps) {
  return (
    <PlaybackTransportProvider
      fileHash={song.file_hash}
      initialGuideVolume={config?.guide_volume ?? 0.3}
      masterVolume={config?.master_volume ?? 1}
    >
      <PlaybackThemeProvider song={song} config={config}>
        <PlaybackMicProvider config={config} players={players}>
          <PlaybackTranscriptProvider fileHash={song.file_hash}>
            {children}
          </PlaybackTranscriptProvider>
        </PlaybackMicProvider>
      </PlaybackThemeProvider>
    </PlaybackTransportProvider>
  );
}

export {
  PlaybackTransportProvider,
  usePlaybackTransportActions,
  usePlaybackTransportState,
  type PlaybackTransportActions,
  type PlaybackTransportState,
} from './playback-transport-context';

export {
  PlaybackThemeProvider,
  usePlaybackThemeActions,
  usePlaybackThemeState,
  type PlaybackThemeActions,
  type PlaybackThemeState,
} from './playback-theme-context';

export {
  PlaybackMicProvider,
  usePlaybackMicActions,
  usePlaybackMicState,
  type PlaybackMicActions,
  type PlaybackMicState,
  type PlaybackPlayerMicState,
} from './playback-mic-context';

export {
  PlaybackTranscriptProvider,
  usePlaybackTranscriptActions,
  usePlaybackTranscriptState,
  type PlaybackTranscriptActions,
  type PlaybackTranscriptState,
} from './playback-transcript-context';
