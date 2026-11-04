/**
 * The phone's view of the host playback surface: published snapshots come in
 * over the same event bus as the queue, and the phone never owns a clock.
 *
 * The host publishes progress at 1 Hz while audio advances, so the slider
 * interpolates locally between snapshots and snaps back to the host value on
 * every update. That keeps a slow event rate from making the thumb stutter.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import {
  loadPlaybackOptions,
  loadPlaybackProgress,
  onPlaybackOptionsChanged,
  onPlaybackProgressChanged,
  type PlaybackProgress,
} from '@/bridge/playback-remote';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';
import { PLAYBACK_OPTIONS, PLAYBACK_PROGRESS } from '@/shared/query-keys';

const CLOCK_TICK_MS = 250;

type ClockAnchor = {
  positionMs: number;
  at: number;
  playing: boolean;
  durationMs: number;
};

export function useRemotePlayback() {
  const queryClient = useQueryClient();
  const { data: progress } = useQuery({
    queryKey: PLAYBACK_PROGRESS,
    queryFn: loadPlaybackProgress,
  });
  const { data: options } = useQuery({
    queryKey: PLAYBACK_OPTIONS,
    queryFn: loadPlaybackOptions,
  });

  useEffect(() => {
    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    void onPlaybackProgressChanged((next) => {
      queryClient.setQueryData(PLAYBACK_PROGRESS, next);
    }).then((fn) => {
      if (cancelled) {
        fn();
        return undefined;
      }
      unlisteners.push(fn);
      return undefined;
    });

    void onPlaybackOptionsChanged((next) => {
      queryClient.setQueryData(PLAYBACK_OPTIONS, next);
    }).then((fn) => {
      if (cancelled) {
        fn();
        return undefined;
      }
      unlisteners.push(fn);
      return undefined;
    });

    return () => {
      cancelled = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [queryClient]);

  return { progress, options };
}

type RemoteClock = {
  getCurrentTime: () => number;
  subscribe: (fn: (time: number) => void) => () => void;
  /** Optimistic jump so the slider does not snap back before the host echoes. */
  setPosition: (seconds: number) => void;
};

function useRemoteClock(progress: PlaybackProgress | undefined): RemoteClock {
  const anchorRef = useRef<ClockAnchor>({
    positionMs: 0,
    at: 0,
    playing: false,
    durationMs: 0,
  });
  const listenersRef = useRef(new Set<(time: number) => void>());

  const getCurrentTime = useCallback(() => {
    const anchor = anchorRef.current;
    const elapsed = anchor.playing ? performance.now() - anchor.at : 0;
    const positionMs = Math.max(0, Math.min(anchor.durationMs, anchor.positionMs + elapsed));
    return positionMs / 1000;
  }, []);

  useEffect(() => {
    if (progress === undefined) {
      return;
    }

    anchorRef.current = {
      positionMs: progress.positionMs,
      at: performance.now(),
      playing: progress.playing,
      durationMs: progress.durationMs,
    };
    for (const listener of listenersRef.current) {
      listener(getCurrentTime());
    }
  }, [getCurrentTime, progress]);

  useEffect(() => {
    if (progress?.playing !== true) {
      return undefined;
    }

    const id = setInterval(() => {
      for (const listener of listenersRef.current) {
        listener(getCurrentTime());
      }
    }, CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, [getCurrentTime, progress?.playing]);

  const subscribe = useCallback((fn: (time: number) => void) => {
    const listeners = listenersRef.current;
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  const setPosition = useCallback(
    (seconds: number) => {
      const anchor = anchorRef.current;
      anchorRef.current = {
        ...anchor,
        positionMs: Math.max(0, Math.min(anchor.durationMs, seconds * 1000)),
        at: performance.now(),
      };
      for (const listener of listenersRef.current) {
        listener(getCurrentTime());
      }
    },
    [getCurrentTime],
  );

  return { getCurrentTime, subscribe, setPosition };
}

export type RemoteTransport = Pick<RemoteClock, 'getCurrentTime' | 'subscribe'> & {
  duration: number;
  seek: (seconds: number) => void;
  lines: {
    isAvailable: () => { previous: boolean; next: boolean };
    seek: (delta: 1 | -1) => void;
  };
};

/**
 * Everything `TransportControls` needs, backed by the host's published clock.
 * Line jumps use the host's own line boundaries, so the phone never needs the
 * lyrics.
 */
export function useRemoteTransport(
  progress: PlaybackProgress | undefined,
  onSeek: (seconds: number) => void,
): RemoteTransport {
  const { getCurrentTime, subscribe, setPosition } = useRemoteClock(progress);
  const sendRef = useLatestRef(onSeek);
  const previousLineMs = progress?.previousLineMs ?? null;
  const nextLineMs = progress?.nextLineMs ?? null;

  const seek = useCallback(
    (seconds: number) => {
      setPosition(seconds);
      sendRef.current(seconds);
    },
    [sendRef, setPosition],
  );
  const lines = useMemo(
    () => ({
      isAvailable: () => ({ previous: previousLineMs !== null, next: nextLineMs !== null }),
      seek: (delta: 1 | -1) => {
        const targetMs = delta === 1 ? nextLineMs : previousLineMs;
        if (targetMs !== null) {
          seek(targetMs / 1000);
        }
      },
    }),
    [nextLineMs, previousLineMs, seek],
  );

  return {
    duration: (progress?.durationMs ?? 0) / 1000,
    getCurrentTime,
    subscribe,
    seek,
    lines,
  };
}
