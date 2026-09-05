/**
 * Web Audio–based playback for instrumental + guide vocals, with a shared
 * rAF tick that notifies subscribers for visuals (background sync, lyrics, HUD).
 * The returned API object is referentially stable across renders when its fields are unchanged.
 *
 * Graph: instrumental + (vocals → guide gain) → playback mix → speakers + recording limiter.
 * Playback position is derived from AudioContext.currentTime and a (offset, contextTimeAtStart)
 * pair because BufferSourceNode is one-shot: pause/seek recreate sources rather than mutating time.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PlaybackAdapter } from '@/bridge/playback';
import { playbackAdapter } from '@/bridge/playback';

export type TimeSubscriber = (time: number) => void;

export type RecordingTarget = {
  destination: MediaStreamAudioDestinationNode;
};

export type AudioPlayer = {
  getCurrentTime: () => number;
  subscribe: (fn: TimeSubscriber) => () => void;
  duration: number;
  isReady: boolean;
  isPlaying: boolean;
  isFinished: boolean;
  error: string | null;
  guideVolume: number;
  /** False for LRC-provided songs without stems: the original mix plays and
   * there is no separate guide vocal track to control. */
  guideAvailable: boolean;
  play: () => void;
  pause: () => void;
  resume: () => void;
  seek: (time: number) => void;
  setGuideVolume: (v: number) => void;
  cleanup: () => void;
  getVocalsBuffer: () => AudioBuffer | null;
  getScoringBuffer: () => AudioBuffer | null;
  getAudioContext: () => AudioContext | null;
  getRecordingTarget: () => RecordingTarget | null;
};

export function useAudioPlayer(
  fileHash: string,
  initialGuideVolume: number,
  enabled: boolean,
  adapter: PlaybackAdapter = playbackAdapter,
): AudioPlayer {
  const ctxRef = useRef<AudioContext | null>(null);
  const instrumentalBufRef = useRef<AudioBuffer | null>(null);
  const vocalsBufRef = useRef<AudioBuffer | null>(null);
  const instrumentalSrcRef = useRef<AudioBufferSourceNode | null>(null);
  const vocalsSrcRef = useRef<AudioBufferSourceNode | null>(null);
  const vocalsGainRef = useRef<GainNode | null>(null);
  const playbackMixRef = useRef<GainNode | null>(null);
  const recordingDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const recordingLimiterRef = useRef<DynamicsCompressorNode | null>(null);
  const rafRef = useRef<number>(0);
  const currentTimeRef = useRef(0);
  const subscribersRef = useRef<Set<TimeSubscriber>>(new Set());
  /** Logical playback position (seconds) when the current sources were started. */
  const startOffsetRef = useRef(0);
  /** ctx.currentTime at the moment the current sources started (anchors wall-clock math). */
  const startContextTimeRef = useRef(0);
  const playingRef = useRef(false);
  /** Set on cleanup so async decode/start and onended ignore stale work after unmount. */
  const cancelledRef = useRef(false);

  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guideVolume, setGuideVolumeState] = useState(initialGuideVolume);
  const [guideAvailable, setGuideAvailable] = useState(true);

  const getVocalsBuffer = useCallback(() => vocalsBufRef.current, []);

  const getScoringBuffer = useCallback(
    () => vocalsBufRef.current ?? instrumentalBufRef.current,
    [],
  );

  const getAudioContext = useCallback(() => ctxRef.current, []);

  const getRecordingTarget = useCallback((): RecordingTarget | null => {
    const destination = recordingDestinationRef.current;

    return destination ? { destination } : null;
  }, []);

  const getCurrentTime = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || !playingRef.current) {
      return currentTimeRef.current;
    }

    return startOffsetRef.current + (ctx.currentTime - startContextTimeRef.current);
  }, []);

  const subscribe = useCallback((fn: TimeSubscriber) => {
    subscribersRef.current.add(fn);

    return () => {
      subscribersRef.current.delete(fn);
    };
  }, []);

  const notifySubscribers = useCallback((t: number) => {
    for (const fn of subscribersRef.current) {
      fn(t);
    }
  }, []);

  const stopSources = useCallback(() => {
    playingRef.current = false;

    try {
      instrumentalSrcRef.current?.stop();
    } catch {
      /* BufferSourceNode throws if stopped twice */
    }
    try {
      vocalsSrcRef.current?.stop();
    } catch {
      /* BufferSourceNode throws if stopped twice */
    }

    instrumentalSrcRef.current = null;
    vocalsSrcRef.current = null;
  }, []);

  const startSources = useCallback(
    (offset: number) => {
      const ctx = ctxRef.current;
      const instBuf = instrumentalBufRef.current;
      const vocBuf = vocalsBufRef.current;
      const gainNode = vocalsGainRef.current;
      const playbackMix = playbackMixRef.current;

      if (!ctx || !instBuf || !playbackMix) {
        return;
      }

      stopSources();

      const clamped = Math.max(0, Math.min(offset, instBuf.duration));

      const instSrc = ctx.createBufferSource();
      instSrc.buffer = instBuf;
      instSrc.connect(playbackMix);

      instSrc.addEventListener(
        'ended',
        () => {
          if (
            !cancelledRef.current &&
            playingRef.current &&
            instrumentalSrcRef.current === instSrc
          ) {
            playingRef.current = false;

            setIsFinished(true);
            setIsPlaying(false);
          }
        },
        { once: true },
      );

      startOffsetRef.current = clamped;
      startContextTimeRef.current = ctx.currentTime;

      instSrc.start(0, clamped);
      instrumentalSrcRef.current = instSrc;

      // No vocals stem (LRC-provided, no separation): play the original mix
      // through the instrumental node only.
      if (vocBuf && gainNode) {
        const vocSrc = ctx.createBufferSource();
        vocSrc.buffer = vocBuf;
        vocSrc.connect(gainNode);
        vocSrc.start(0, clamped);
        vocalsSrcRef.current = vocSrc;
      }

      playingRef.current = true;
    },
    [stopSources],
  );

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let cancelled = false;

    cancelledRef.current = false;
    playingRef.current = false;

    startOffsetRef.current = 0;
    startContextTimeRef.current = 0;
    currentTimeRef.current = 0;

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const playbackMix = ctx.createGain();
    playbackMix.connect(ctx.destination);
    playbackMixRef.current = playbackMix;

    const recordingDestination = ctx.createMediaStreamDestination();
    recordingDestinationRef.current = recordingDestination;

    const recordingLimiter = ctx.createDynamicsCompressor();
    recordingLimiter.threshold.value = -1;
    recordingLimiter.knee.value = 0;
    recordingLimiter.ratio.value = 20;
    recordingLimiter.attack.value = 0.003;
    recordingLimiter.release.value = 0.25;
    recordingLimiter.connect(recordingDestination);
    playbackMix.connect(recordingLimiter);
    recordingLimiterRef.current = recordingLimiter;

    const gainNode = ctx.createGain();
    gainNode.gain.value = Math.max(0, Math.min(1, initialGuideVolume));
    gainNode.connect(playbackMix);
    vocalsGainRef.current = gainNode;

    const isCancelled = () => cancelled || cancelledRef.current;

    adapter
      .getAudioPaths(fileHash)
      .then(async (paths) => {
        if (isCancelled()) {
          return undefined;
        }

        const vocalsUrl = paths.vocals;
        setGuideAvailable(vocalsUrl !== null);

        const [instData, vocData] = await Promise.all([
          fetch(paths.instrumental).then((r) => {
            if (!r.ok) {
              throw new Error(`Failed to fetch instrumental: ${r.status}`);
            }

            return r.arrayBuffer();
          }),

          vocalsUrl === null
            ? Promise.resolve(null)
            : fetch(vocalsUrl).then((r) => {
                if (!r.ok) {
                  throw new Error(`Failed to fetch vocals: ${r.status}`);
                }

                return r.arrayBuffer();
              }),
        ]);

        if (isCancelled()) {
          return undefined;
        }

        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        const [instBuf, vocBuf] = await Promise.all([
          ctx.decodeAudioData(instData),
          vocData === null ? Promise.resolve(null) : ctx.decodeAudioData(vocData),
        ]);

        if (isCancelled()) {
          return undefined;
        }

        instrumentalBufRef.current = instBuf;
        vocalsBufRef.current = vocBuf;

        setDuration(instBuf.duration);

        startSources(0);
        setIsReady(true);
        setIsPlaying(true);
        return undefined;
      })
      .catch((e: unknown) => {
        if (!isCancelled()) {
          setError(`Failed to load audio: ${e instanceof Error ? e.message : String(e)}`);
        }
      });

    let lastNotify = 0;
    const NOTIFY_INTERVAL = 33;

    const tick = () => {
      if (isCancelled()) {
        return;
      }

      if (playingRef.current && ctxRef.current) {
        const now = performance.now();
        const t =
          startOffsetRef.current + (ctxRef.current.currentTime - startContextTimeRef.current);
        currentTimeRef.current = t;

        if (now - lastNotify >= NOTIFY_INTERVAL) {
          lastNotify = now;
          for (const fn of subscribersRef.current) {
            fn(t);
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      stopSources();
      instrumentalBufRef.current = null;
      vocalsBufRef.current = null;
      vocalsGainRef.current = null;
      playbackMixRef.current = null;
      recordingDestinationRef.current = null;
      recordingLimiterRef.current = null;
      void ctx.close();
      ctxRef.current = null;
    };
  }, [adapter, enabled, fileHash, initialGuideVolume, startSources, stopSources]);

  const play = useCallback(() => {
    startSources(startOffsetRef.current);
    setIsPlaying(true);
  }, [startSources]);

  const pause = useCallback(() => {
    const ctx = ctxRef.current;
    if (ctx && playingRef.current) {
      startOffsetRef.current += ctx.currentTime - startContextTimeRef.current;
    }

    stopSources();
    setIsPlaying(false);
  }, [stopSources]);

  const resume = useCallback(() => {
    startSources(startOffsetRef.current);
    setIsPlaying(true);
  }, [startSources]);

  const seek = useCallback(
    (time: number) => {
      const wasPlaying = playingRef.current;

      stopSources();

      startOffsetRef.current = time;
      currentTimeRef.current = time;

      if (wasPlaying) {
        startSources(time);
        setIsPlaying(true);
      }

      notifySubscribers(time);
      setIsFinished(false);
    },
    [stopSources, startSources, notifySubscribers],
  );

  const setGuideVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));

    setGuideVolumeState(clamped);

    if (vocalsGainRef.current) {
      vocalsGainRef.current.gain.value = clamped;
    }
  }, []);

  const cleanup = useCallback(() => {
    cancelledRef.current = true;

    cancelAnimationFrame(rafRef.current);

    stopSources();

    void ctxRef.current?.close();
    ctxRef.current = null;
    playbackMixRef.current = null;
    recordingDestinationRef.current = null;
    recordingLimiterRef.current = null;
  }, [stopSources]);

  return useMemo(
    () => ({
      getCurrentTime,
      subscribe,
      duration,
      isReady,
      isPlaying,
      isFinished,
      error,
      guideVolume,
      guideAvailable,
      play,
      pause,
      resume,
      seek,
      setGuideVolume,
      cleanup,
      getVocalsBuffer,
      getScoringBuffer,
      getAudioContext,
      getRecordingTarget,
    }),
    [
      getCurrentTime,
      subscribe,
      duration,
      isReady,
      isPlaying,
      isFinished,
      error,
      guideVolume,
      guideAvailable,
      play,
      pause,
      resume,
      seek,
      setGuideVolume,
      cleanup,
      getVocalsBuffer,
      getScoringBuffer,
      getAudioContext,
      getRecordingTarget,
    ],
  );
}
