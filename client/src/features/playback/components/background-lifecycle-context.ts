import { createContext, useContext } from 'react';

export type BackgroundLifecycle = {
  ready: () => void;
  failed: (message: string) => void;
};

export const BackgroundLifecycleContext = createContext<BackgroundLifecycle | null>(null);

export function useBackgroundLifecycle(): BackgroundLifecycle {
  const context = useContext(BackgroundLifecycleContext);
  if (!context) {
    throw new Error('useBackgroundLifecycle must be used within a BackgroundLifecycleProvider');
  }
  return context;
}
