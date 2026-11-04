import { useEffect } from 'react';

import {
  onPlaybackCommandRequested,
  setPlaybackStatus,
  type PlaybackCommand,
  type PlaybackStatus,
} from '@/bridge/playback-status';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';

type PlaybackCommandHandlers = Record<PlaybackCommand, () => void>;

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
      void setPlaybackStatus({
        active: false,
        paused: false,
        finished: false,
        hasNext: false,
        sessionPlayback: false,
      }).catch(() => undefined);
    };
  }, []);

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
