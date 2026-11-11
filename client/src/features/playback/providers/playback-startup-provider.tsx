import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { themeKey } from '@/features/playback/components/theme';

import {
  PlaybackStartupActionsContext,
  PlaybackStartupStateContext,
  type PlaybackStartupActions,
  type PlaybackStartupState,
} from './playback-startup-context';
import { usePlaybackThemeState } from './playback-theme-context';
import { usePlaybackTranscriptState } from './playback-transcript-context';
import {
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from './playback-transport-context';

export function PlaybackStartupProvider({
  children,
  deferStart = false,
}: {
  children: ReactNode;
  /** Room playback starts on the node's shared clock instead of locally. */
  deferStart?: boolean;
}) {
  const { isReady: audioReady } = usePlaybackTransportState();
  const { startPlayback } = usePlaybackTransportActions();
  const { isReady: transcriptReady } = usePlaybackTranscriptState();
  const { theme } = usePlaybackThemeState();
  const activeThemeKey = themeKey(theme);
  const [readyBackgroundKey, setReadyBackgroundKey] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const markBackgroundReady = useCallback((key: string) => {
    setReadyBackgroundKey(key);
  }, []);

  useEffect(() => {
    if (!audioReady || !transcriptReady || readyBackgroundKey !== activeThemeKey || started) {
      return undefined;
    }

    let paintFrame = 0;
    const commitFrame = requestAnimationFrame(() => {
      paintFrame = requestAnimationFrame(() => setStarted(true));
    });

    return () => {
      cancelAnimationFrame(commitFrame);
      cancelAnimationFrame(paintFrame);
    };
  }, [activeThemeKey, audioReady, readyBackgroundKey, started, transcriptReady]);

  useEffect(() => {
    if (!started || deferStart) {
      return undefined;
    }

    const playbackFrame = requestAnimationFrame(startPlayback);
    return () => cancelAnimationFrame(playbackFrame);
  }, [deferStart, startPlayback, started]);

  const stateValue = useMemo<PlaybackStartupState>(() => ({ started }), [started]);
  const actionsValue = useMemo<PlaybackStartupActions>(
    () => ({ markBackgroundReady }),
    [markBackgroundReady],
  );

  return (
    <PlaybackStartupStateContext.Provider value={stateValue}>
      <PlaybackStartupActionsContext.Provider value={actionsValue}>
        {children}
      </PlaybackStartupActionsContext.Provider>
    </PlaybackStartupStateContext.Provider>
  );
}
