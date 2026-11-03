import type { Update } from '@tauri-apps/plugin-updater';
import { useCallback, useReducer } from 'react';
import { toast } from 'sonner';

import { downloadAndInstallUpdate, relaunchApp } from '@/bridge/updater';
import { t } from '@/i18n';

export type InstallState =
  | { stage: 'idle' }
  | { stage: 'downloading'; downloaded: number; contentLength: number | null }
  | { stage: 'installing' }
  | { stage: 'finished' }
  | { stage: 'error'; message: string };

type InstallAction =
  | { type: 'start' }
  | { type: 'progress-start'; contentLength: number | null }
  | { type: 'progress-tick'; chunk: number }
  | { type: 'installing' }
  | { type: 'finished' }
  | { type: 'error'; message: string }
  | { type: 'reset' };

const reducer = (state: InstallState, action: InstallAction): InstallState => {
  switch (action.type) {
    case 'start':
      return { stage: 'downloading', downloaded: 0, contentLength: null };
    case 'progress-start':
      return { stage: 'downloading', downloaded: 0, contentLength: action.contentLength };
    case 'progress-tick':
      if (state.stage !== 'downloading') {
        return state;
      }
      return { ...state, downloaded: state.downloaded + action.chunk };
    case 'installing':
      return { stage: 'installing' };
    case 'finished':
      return { stage: 'finished' };
    case 'error':
      return { stage: 'error', message: action.message };
    case 'reset':
      return { stage: 'idle' };
  }
  action satisfies never;
  return state;
};

export type InstallFlow = ReturnType<typeof useInstallFlow>;

export const useInstallFlow = (update: Update | null) => {
  const [state, dispatch] = useReducer(reducer, { stage: 'idle' });

  const install = useCallback(async () => {
    if (!update) {
      return;
    }
    dispatch({ type: 'start' });
    try {
      await downloadAndInstallUpdate(update, (event) => {
        switch (event.event) {
          case 'Started':
            dispatch({ type: 'progress-start', contentLength: event.data.contentLength ?? null });
            break;
          case 'Progress':
            dispatch({ type: 'progress-tick', chunk: event.data.chunkLength });
            break;
          case 'Finished':
            dispatch({ type: 'installing' });
            break;
        }
      });
      dispatch({ type: 'finished' });
    } catch (err) {
      const message = err instanceof Error ? err.message : t('common.errors.unknown');
      dispatch({ type: 'error', message });
      toast.error(t('updates.useInstallFlow.updateFailed', { value1: message }));
    }
  }, [update]);

  const restart = useCallback(async () => {
    try {
      await relaunchApp();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('common.errors.unknown');
      toast.error(t('updates.useInstallFlow.restartFailed', { value1: message }));
    }
  }, []);

  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  return { state, install, restart, reset };
};
