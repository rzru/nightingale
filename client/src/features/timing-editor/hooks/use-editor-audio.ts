import { useCallback, useEffect, useRef, useState } from 'react';

import { playbackAdapter } from '@/bridge/playback';
import { loadPeaks, type Peaks } from '@/features/timing-editor/lib/waveform';

export type EditorTrack = 'all' | 'vocals' | 'music';

export type LoopRange = { start: number; end: number };

const trackVolumes = (
  track: EditorTrack,
  hasVocals: boolean,
): { vocals: number; music: number } => {
  if (!hasVocals) {
    return { vocals: 0, music: 1 };
  }
  if (track === 'vocals') {
    return { vocals: 1, music: 0 };
  }
  return track === 'music' ? { vocals: 0, music: 1 } : { vocals: 1, music: 1 };
};

/**
 * Playback for the timing editor: the two stems as media elements kept in
 * step, with a track choice, slow-down and looping of a time range.
 */
export function useEditorAudio(fileHash: string) {
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const vocalsRef = useRef<HTMLAudioElement | null>(null);
  const loopRef = useRef<LoopRange | null>(null);
  const [ready, setReady] = useState(false);
  const [hasVocals, setHasVocals] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [track, setTrackState] = useState<EditorTrack>('all');
  const [rate, setRateState] = useState(1);

  useEffect(() => {
    let cancelled = false;
    // Read through a function: the flag changes while the loader awaits.
    const isCancelled = () => cancelled;
    const music = new Audio();
    const vocals = new Audio();
    music.preload = 'auto';
    vocals.preload = 'auto';
    musicRef.current = music;
    vocalsRef.current = vocals;

    const onMeta = () => setDuration(Number.isFinite(music.duration) ? music.duration : 0);
    const onEnded = () => setPlaying(false);
    music.addEventListener('loadedmetadata', onMeta);
    music.addEventListener('ended', onEnded);

    void (async () => {
      try {
        await playbackAdapter.init();
        const paths = await playbackAdapter.getAudioPaths(fileHash);
        if (isCancelled()) {
          return;
        }
        music.src = paths.instrumental;
        if (paths.vocals !== null) {
          vocals.src = paths.vocals;
        }
        setHasVocals(paths.vocals !== null);
        setReady(true);
        // The wave shows the voice when there is a vocal stem.
        const wave = await loadPeaks(paths.vocals ?? paths.instrumental);
        if (!isCancelled()) {
          setPeaks(wave);
        }
      } catch (cause) {
        if (!isCancelled()) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    })();

    return () => {
      cancelled = true;
      music.removeEventListener('loadedmetadata', onMeta);
      music.removeEventListener('ended', onEnded);
      music.pause();
      vocals.pause();
      music.removeAttribute('src');
      vocals.removeAttribute('src');
    };
  }, [fileHash]);

  // Track choice and speed apply to both elements.
  useEffect(() => {
    const volumes = trackVolumes(track, hasVocals);
    if (musicRef.current) {
      musicRef.current.volume = volumes.music;
      musicRef.current.playbackRate = rate;
    }
    if (vocalsRef.current) {
      vocalsRef.current.volume = volumes.vocals;
      vocalsRef.current.playbackRate = rate;
    }
  }, [hasVocals, rate, track]);

  const seek = useCallback((next: number) => {
    const target = Math.max(0, next);
    if (musicRef.current) {
      musicRef.current.currentTime = target;
    }
    if (vocalsRef.current) {
      vocalsRef.current.currentTime = target;
    }
    setTime(target);
  }, []);

  // Follow the playhead, keep the stems together and apply the loop.
  useEffect(() => {
    if (!playing) {
      return undefined;
    }
    let frame = 0;
    const tick = () => {
      const music = musicRef.current;
      const vocals = vocalsRef.current;
      if (music) {
        const loop = loopRef.current;
        if (loop !== null && music.currentTime >= loop.end) {
          seek(loop.start);
        } else if (vocals && Math.abs(vocals.currentTime - music.currentTime) > 0.05) {
          vocals.currentTime = music.currentTime;
        }
        setTime(music.currentTime);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, seek]);

  const play = useCallback(() => {
    const music = musicRef.current;
    if (!music) {
      return;
    }
    void music.play().catch(() => setPlaying(false));
    if (vocalsRef.current && vocalsRef.current.src !== '') {
      void vocalsRef.current.play().catch(() => {});
    }
    setPlaying(true);
  }, []);

  const pause = useCallback(() => {
    musicRef.current?.pause();
    vocalsRef.current?.pause();
    setPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (musicRef.current && !musicRef.current.paused) {
      pause();
    } else {
      play();
    }
  }, [pause, play]);

  const setLoop = useCallback((range: LoopRange | null) => {
    loopRef.current = range;
  }, []);

  /** Exact playhead position, for tap timing between rendered frames. */
  const now = useCallback(() => musicRef.current?.currentTime ?? 0, []);

  return {
    ready,
    error,
    hasVocals,
    playing,
    time,
    duration,
    peaks,
    track,
    rate,
    setTrack: setTrackState,
    setRate: setRateState,
    play,
    pause,
    toggle,
    seek,
    setLoop,
    now,
  };
}

export type EditorAudio = ReturnType<typeof useEditorAudio>;
