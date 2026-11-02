import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { PhysicalSize } from '@tauri-apps/api/window';
import { z } from 'zod';

import { invoke, isTauri, listen, type UnlistenFn } from './runtime';
import { playbackLocationStateSchema, type playbackPlayerSchema } from './schemas';

const SESSION_PLAYBACK_URL = '/playback?session=1';

type WindowState = {
  width: number | null;
  height: number | null;
  maximized: boolean;
};

const playbackSessionSchema = playbackLocationStateSchema.extend({
  queuePlayback: z.boolean(),
});

export type PlaybackPlayer = z.infer<typeof playbackPlayerSchema>;
export type PlaybackSession = z.infer<typeof playbackSessionSchema>;
export type PlaybackTarget = Window | null | undefined;

const parseSession = (value: unknown): PlaybackSession => playbackSessionSchema.parse(value);

export const isSessionPlayback = (): boolean =>
  window.location.pathname === '/playback' &&
  new URLSearchParams(window.location.search).has('session');

export const loadPlaybackSession = async (): Promise<PlaybackSession | null> => {
  const value = await invoke('load_playback_session');
  return value === null ? null : parseSession(value);
};

export const savePlaybackSession = async (session: PlaybackSession): Promise<PlaybackSession> =>
  parseSession(await invoke('save_playback_session', { session }));

export const onPlaybackSessionChanged = async (
  callback: (session: PlaybackSession) => void,
): Promise<UnlistenFn> =>
  await listen<unknown>('playback-session-changed', ({ payload }) =>
    callback(parseSession(payload)),
  );

export const reservePlaybackTarget = (): PlaybackTarget => {
  if (isTauri || isSessionPlayback()) {
    return null;
  }
  return window.open(SESSION_PLAYBACK_URL, 'nightingale-playback') ?? undefined;
};

export const showPlaybackTarget = async (target: PlaybackTarget): Promise<void> => {
  if (!isTauri) {
    if (!target) {
      throw new Error('Browser blocked playback tab');
    }
    target.focus();
    return;
  }

  const existing = await WebviewWindow.getByLabel('playback');
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }

  const state = await invoke<WindowState>('load_window_state', { label: 'playback' });
  const playbackWindow = new WebviewWindow('playback', {
    url: SESSION_PLAYBACK_URL,
    title: 'Nightingale Playback',
    width: 1280,
    height: 720,
    decorations: false,
    visible: false,
  });
  await new Promise<void>((resolve, reject) => {
    void playbackWindow.once('tauri://created', () => resolve());
    void playbackWindow.once<unknown>('tauri://error', ({ payload }) =>
      reject(new Error(String(payload))),
    );
  });
  if (state.width !== null && state.height !== null) {
    await playbackWindow.setSize(new PhysicalSize(state.width, state.height));
  }
  if (state.maximized) {
    await playbackWindow.maximize();
  }
  await invoke<void>('track_window_state', { label: 'playback' });
  await playbackWindow.show();
  await playbackWindow.setFocus();
};
