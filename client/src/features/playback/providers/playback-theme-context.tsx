/**
 * Owns visual background selection, Pixabay flavor, and playable song-video path.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { ensurePlayableSourceVideo } from '@/bridge/playback';
import {
  createPlaybackThemes,
  initialThemeKey,
  nextThemeKey,
  selectionForTheme,
  themeKey,
  type PlaybackTheme,
} from '@/features/playback/components/theme';
import { usePlaybackConfigPersist } from '@/features/playback/hooks/use-playback-config-persist';
import {
  FLAVORS,
  getNextFlavor,
  isVideoFlavor,
  type VideoFlavor,
} from '@/features/playback/lib/video-flavor';
import type { AppConfig } from '@/types/AppConfig';
import type { Song } from '@/types/Song';

export type PlaybackThemeState = {
  theme: PlaybackTheme;
  themes: readonly PlaybackTheme[];
  videoFlavor: VideoFlavor;
  sourceVideoPath: string | undefined;
  sourceVideoTempoRatio: number;
};

export type PlaybackThemeActions = {
  cycleTheme: () => void;
  cycleFlavor: () => void;
  selectTheme: (key: string) => void;
  selectFlavor: (key: string) => void;
};

const ThemeStateContext = createContext<PlaybackThemeState | null>(null);
const ThemeActionsContext = createContext<PlaybackThemeActions | null>(null);

type PlaybackThemeProviderProps = {
  song: Song;
  config: AppConfig | null;
  children: ReactNode;
};

type PlayableVideo = { fileHash: string; path: string };

function resolveSourceVideoPath(
  song: Song,
  playableVideo: PlayableVideo | null,
): string | undefined {
  if (!song.is_video) {
    return undefined;
  }
  return playableVideo?.fileHash === song.file_hash ? playableVideo.path : song.path;
}

export function PlaybackThemeProvider({ song, config, children }: PlaybackThemeProviderProps) {
  const fileHash = song.file_hash;
  const themes = useMemo(
    () => createPlaybackThemes(config?.custom_backgrounds ?? [], song.is_video),
    [config?.custom_backgrounds, song.is_video],
  );
  const [currentThemeKey, setCurrentThemeKey] = useState(() =>
    initialThemeKey({
      themes,
      hasSourceVideo: song.is_video,
      selection: config?.last_background,
      legacyIndex: config?.last_theme ?? 0,
    }),
  );
  const [flavorIndex, setFlavorIndex] = useState(config?.last_video_flavor ?? 0);
  const [playableVideo, setPlayableVideo] = useState<PlayableVideo | null>(null);
  const persistConfig = usePlaybackConfigPersist(config);

  useEffect(() => {
    if (!song.is_video) {
      return undefined;
    }

    let cancelled = false;
    void ensurePlayableSourceVideo(fileHash)
      .then((path) => {
        if (!cancelled && typeof path === 'string' && path !== '') {
          setPlayableVideo({ fileHash, path });
        }
        return undefined;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [fileHash, song.is_video]);

  const theme = themes.find((candidate) => themeKey(candidate) === currentThemeKey) ?? themes[0];
  const sourceVideoPath = resolveSourceVideoPath(song, playableVideo);

  const selectTheme = useCallback(
    (key: string) => {
      const next = themes.find((candidate) => themeKey(candidate) === key);
      if (!next) {
        return;
      }
      setCurrentThemeKey(key);
      const selection = selectionForTheme(next);
      if (selection) {
        persistConfig({ last_background: selection });
      }
    },
    [persistConfig, themes],
  );

  const selectFlavor = useCallback(
    (key: string) => {
      if (!isVideoFlavor(key)) {
        return;
      }
      const index = FLAVORS.indexOf(key);
      setFlavorIndex(index);
      persistConfig({ last_video_flavor: index });
    },
    [persistConfig],
  );

  const cycleTheme = useCallback(() => {
    selectTheme(nextThemeKey(themes, themeKey(theme)));
  }, [selectTheme, theme, themes]);

  const cycleFlavor = useCallback(() => {
    selectFlavor(getNextFlavor(FLAVORS[flavorIndex % FLAVORS.length]));
  }, [flavorIndex, selectFlavor]);

  const stateValue = useMemo<PlaybackThemeState>(
    () => ({
      theme,
      themes,
      videoFlavor: FLAVORS[flavorIndex % FLAVORS.length],
      sourceVideoPath,
      sourceVideoTempoRatio: song.tempo,
    }),
    [theme, themes, flavorIndex, sourceVideoPath, song.tempo],
  );

  const actionsValue = useMemo<PlaybackThemeActions>(
    () => ({ cycleTheme, cycleFlavor, selectTheme, selectFlavor }),
    [cycleFlavor, cycleTheme, selectFlavor, selectTheme],
  );

  return (
    <ThemeStateContext.Provider value={stateValue}>
      <ThemeActionsContext.Provider value={actionsValue}>{children}</ThemeActionsContext.Provider>
    </ThemeStateContext.Provider>
  );
}

export function usePlaybackThemeState(): PlaybackThemeState {
  const ctx = useContext(ThemeStateContext);
  if (!ctx) {
    throw new Error('usePlaybackThemeState must be used within a PlaybackThemeProvider');
  }
  return ctx;
}

export function usePlaybackThemeActions(): PlaybackThemeActions {
  const ctx = useContext(ThemeActionsContext);
  if (!ctx) {
    throw new Error('usePlaybackThemeActions must be used within a PlaybackThemeProvider');
  }
  return ctx;
}
