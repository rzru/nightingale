import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';

import {
  onPlaybackCommandRequested,
  setPlaybackStatus,
  type PlaybackCommand,
  type PlaybackStatus,
} from '@/bridge/playback-status';
import { isTauri } from '@/bridge/runtime';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';

type PlaybackCommandHandlers = Record<PlaybackCommand, () => void>;

const IDLE_STATUS: PlaybackStatus = {
  active: false,
  paused: false,
  finished: false,
  hasNext: false,
  sessionPlayback: false,
};

const publishIdleStatus = (): Promise<void> =>
  setPlaybackStatus(IDLE_STATUS).catch(() => undefined);

/**
 * Bridges the playback surface to remote clients. It publishes what a remote
 * may do right now and runs the commands it sends, so every client sees the
 * same actions and none of them re-implement the host's behaviour.
 *
 * Mounted once, inside the playback surface itself.
 */
export function usePlaybackRemote(status: PlaybackStatus, handlers: PlaybackCommandHandlers) {
  const handlersRef = useLatestRef(handlers);
  const { active, paused, finished, hasNext, sessionPlayback } = status;

  useEffect(() => {
    void setPlaybackStatus({ active, paused, finished, hasNext, sessionPlayback }).catch(
      () => undefined,
    );
  }, [active, paused, finished, hasNext, sessionPlayback]);

  useEffect(() => {
    return () => {
      void publishIdleStatus();
    };
  }, []);

  // The session playback window/tab is torn down without unmounting React, so
  // the cleanup above never runs. Publish the idle snapshot on the way out, or
  // phones keep showing a transport that no longer exists.
  useEffect(() => {
    if (!sessionPlayback) {
      return undefined;
    }

    if (!isTauri) {
      const onPageHide = () => {
        void publishIdleStatus();
      };
      window.addEventListener('pagehide', onPageHide);
      return () => window.removeEventListener('pagehide', onPageHide);
    }

    const win = getCurrentWindow();
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void win
      .onCloseRequested((event) => {
        event.preventDefault();
        void publishIdleStatus().finally(() => void win.destroy().catch(() => undefined));
      })
      .then((fn) => {
        if (cancelled) {
          fn();
          return undefined;
        }
        unlisten = fn;
        return undefined;
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [sessionPlayback]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void onPlaybackCommandRequested((command) => handlersRef.current[command]()).then((fn) => {
      if (cancelled) {
        fn();
        return undefined;
      }
      unlisten = fn;
      return undefined;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [handlersRef]);
}
