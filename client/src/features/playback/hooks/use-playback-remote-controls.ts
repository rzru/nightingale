/**
 * Publishes the playback surface's transport and settings so phones can mirror
 * them, and runs the controls they send back.
 *
 * Progress is the only high-frequency part: it is pushed on every discrete
 * change and at most once a second while audio advances, so remotes can
 * interpolate between updates instead of owning a clock.
 */

import { useCallback, useEffect, useRef } from 'react';

import {
  onPlaybackControlRequested,
  savePlaybackOptions,
  savePlaybackProgress,
  type PlaybackControl,
  type PlaybackOptions,
  type PlaybackProgress,
} from '@/bridge/playback-remote';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';

const PROGRESS_TICK_MS = 1000;

const IDLE_PROGRESS: PlaybackProgress = {
  active: false,
  playing: false,
  paused: false,
  finished: false,
  hasNext: false,
  sessionPlayback: false,
  positionMs: 0,
  durationMs: 0,
  skipIntro: false,
  skipOutro: false,
  previousLineMs: null,
  nextLineMs: null,
};

export function usePlaybackRemotePublisher(
  readProgress: () => PlaybackProgress,
  options: PlaybackOptions,
  subscribe: (fn: (time: number) => void) => () => void,
) {
  const progressRef = useLatestRef(readProgress);
  const optionsRef = useLatestRef(options);
  const lastPublishRef = useRef(0);
  // Read once for change detection; publishing reads the live clock again.
  const progress = readProgress();

  const publishProgress = useCallback(() => {
    void savePlaybackProgress(progressRef.current()).catch(() => undefined);
  }, [progressRef]);

  const { active, playing, paused, finished, hasNext, sessionPlayback, durationMs } = progress;
  const progressKey = [
    active,
    playing,
    paused,
    finished,
    hasNext,
    sessionPlayback,
    durationMs,
  ].join('|');
  const lastProgressKeyRef = useRef('');

  useEffect(() => {
    if (progressKey === lastProgressKeyRef.current) {
      return;
    }
    lastProgressKeyRef.current = progressKey;
    publishProgress();
  }, [progressKey, publishProgress]);

  // The audio engine already notifies on every frame and on seeks, so ride it:
  // throttled while audio advances, immediate for one-off seeks while paused.
  useEffect(
    () =>
      subscribe(() => {
        const now = performance.now();
        if (progressRef.current().playing && now - lastPublishRef.current < PROGRESS_TICK_MS) {
          return;
        }
        lastPublishRef.current = now;
        publishProgress();
      }),
    [publishProgress, progressRef, subscribe],
  );

  useEffect(
    () => () => {
      void savePlaybackProgress(IDLE_PROGRESS).catch(() => undefined);
    },
    [],
  );

  // Option lists are large and stable, so publish them only when their content
  // changes rather than on every render that produced a new object.
  const optionsKey = JSON.stringify(options);
  const lastOptionsKeyRef = useRef('');

  useEffect(() => {
    if (optionsKey === lastOptionsKeyRef.current) {
      return;
    }
    lastOptionsKeyRef.current = optionsKey;
    void savePlaybackOptions(optionsRef.current).catch(() => undefined);
  }, [optionsKey, optionsRef]);
}

export function usePlaybackRemoteControls(onControl: (control: PlaybackControl) => void) {
  const controlRef = useLatestRef(onControl);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void onPlaybackControlRequested((control) => controlRef.current(control)).then((fn) => {
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
  }, [controlRef]);
}
