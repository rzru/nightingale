import { createContext, useContext } from 'react';

export type PlaybackStartupState = {
  started: boolean;
};

export type PlaybackStartupActions = {
  markBackgroundReady: (key: string) => void;
};

export const PlaybackStartupStateContext = createContext<PlaybackStartupState | null>(null);
export const PlaybackStartupActionsContext = createContext<PlaybackStartupActions | null>(null);

export function usePlaybackStartupState(): PlaybackStartupState {
  const context = useContext(PlaybackStartupStateContext);
  if (!context) {
    throw new Error('usePlaybackStartupState must be used within a PlaybackStartupProvider');
  }
  return context;
}

export function usePlaybackStartupActions(): PlaybackStartupActions {
  const context = useContext(PlaybackStartupActionsContext);
  if (!context) {
    throw new Error('usePlaybackStartupActions must be used within a PlaybackStartupProvider');
  }
  return context;
}
