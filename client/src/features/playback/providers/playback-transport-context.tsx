/**
 * Owns the audio engine for the active song: wraps `useAudioPlayer`, the
 * stems-ready handshake, the user-facing `paused` flag, and the pause/continue/
 * exit handlers shared by overlays, hotkeys, and the result dialog.
 *
 * Splits state and actions into two contexts so consumers that only need
 * stable callbacks (subscribe, getCurrentTime, handlePause...) don't re-render
 * when reactive fields like `isPlaying` or `guideVolume` change.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import { ensureMp3Stems, onStemsReady } from '@/bridge/playback';
import { isSessionPlayback } from '@/bridge/playback-session';
import { closePlaybackWindow } from '@/bridge/window';
import {
  type AudioPlayer,
  type TimeSubscriber,
  useAudioPlayer,
} from '@/features/playback/hooks/use-audio-player';

export type PlaybackTransportState = {
  isReady: boolean;
  isPlaying: boolean;
  isFinished: boolean;
  paused: boolean;
  duration: number;
  guideVolume: number;
  guideAvailable: boolean;
  error: string | null;
};

export type PlaybackTransportActions = {
  subscribe: (fn: TimeSubscriber) => () => void;
  getCurrentTime: () => number;
  seek: (time: number) => void;
  setGuideVolume: (volume: number) => void;
  getVocalsBuffer: AudioPlayer['getVocalsBuffer'];
  getScoringBuffer: AudioPlayer['getScoringBuffer'];
  getAudioContext: AudioPlayer['getAudioContext'];
  getRecordingTarget: AudioPlayer['getRecordingTarget'];
  /** Raw audio-engine pause; does NOT raise the `paused` UI flag. */
  pauseAudio: () => void;
  handlePause: () => void;
  handleContinue: () => void;
  handleExit: () => void;
};

const TransportStateContext = createContext<PlaybackTransportState | null>(null);
const TransportActionsContext = createContext<PlaybackTransportActions | null>(null);

type PlaybackTransportProviderProps = {
  fileHash: string;
  initialGuideVolume: number;
  children: ReactNode;
};

export function PlaybackTransportProvider({
  fileHash,
  initialGuideVolume,
  children,
}: PlaybackTransportProviderProps) {
  const navigate = useNavigate();
  // Snapshot the initial guide volume so changing config later doesn't
  // re-instantiate the audio engine via useAudioPlayer's effect deps.
  const [initialGuideVolumeSnapshot] = useState(initialGuideVolume);

  const [stemsReady, setStemsReady] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    // Register the listener BEFORE invoking the command. On a page reload the
    // WS handshake races the `stems-ready` broadcast — if the listener isn't
    // attached (or the socket isn't open) when the server emits, the event
    // is gone forever and `stemsReady` stays false, leaving the page stuck
    // on a black screen. `onStemsReady` awaits the socket open under the
    // hood, so once its promise resolves we are guaranteed to receive the
    // event the command triggers.
    void onStemsReady((event) => {
      if (event.file_hash !== fileHash) {
        return;
      }
      if (typeof event.error === 'string' && event.error !== '') {
        toast.error(`Stem conversion failed: ${event.error}`);
        void navigate('/', { replace: true });
      } else {
        setStemsReady(true);
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
        return undefined;
      }
      unlisten = fn;
      ensureMp3Stems(fileHash);
      return undefined;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [fileHash, navigate]);

  const audio = useAudioPlayer(fileHash, initialGuideVolumeSnapshot, stemsReady);

  useEffect(() => {
    if (typeof audio.error === 'string' && audio.error !== '') {
      toast.error(audio.error);
      void navigate('/', { replace: true });
    }
  }, [audio.error, navigate]);

  const handlePause = useCallback(() => {
    audio.pause();
    setPaused(true);
  }, [audio]);

  const handleContinue = useCallback(() => {
    setPaused(false);
    audio.resume();
  }, [audio]);

  const handleExit = useCallback(() => {
    audio.cleanup();
    if (isSessionPlayback()) {
      void closePlaybackWindow();
      return;
    }
    void navigate('/', { replace: true });
  }, [audio, navigate]);

  const stateValue = useMemo<PlaybackTransportState>(
    () => ({
      isReady: audio.isReady,
      isPlaying: audio.isPlaying,
      isFinished: audio.isFinished,
      paused,
      duration: audio.duration,
      guideVolume: audio.guideVolume,
      guideAvailable: audio.guideAvailable,
      error: audio.error,
    }),
    [
      audio.isReady,
      audio.isPlaying,
      audio.isFinished,
      audio.duration,
      audio.guideVolume,
      audio.guideAvailable,
      audio.error,
      paused,
    ],
  );

  const actionsValue = useMemo<PlaybackTransportActions>(
    () => ({
      subscribe: audio.subscribe,
      getCurrentTime: audio.getCurrentTime,
      seek: audio.seek,
      setGuideVolume: audio.setGuideVolume,
      getVocalsBuffer: audio.getVocalsBuffer,
      getScoringBuffer: audio.getScoringBuffer,
      getAudioContext: audio.getAudioContext,
      getRecordingTarget: audio.getRecordingTarget,
      pauseAudio: audio.pause,
      handlePause,
      handleContinue,
      handleExit,
    }),
    [
      audio.subscribe,
      audio.getCurrentTime,
      audio.seek,
      audio.setGuideVolume,
      audio.getVocalsBuffer,
      audio.getScoringBuffer,
      audio.getAudioContext,
      audio.getRecordingTarget,
      audio.pause,
      handlePause,
      handleContinue,
      handleExit,
    ],
  );

  return (
    <TransportStateContext.Provider value={stateValue}>
      <TransportActionsContext.Provider value={actionsValue}>
        {children}
      </TransportActionsContext.Provider>
    </TransportStateContext.Provider>
  );
}

export function usePlaybackTransportState(): PlaybackTransportState {
  const ctx = useContext(TransportStateContext);
  if (!ctx) {
    throw new Error('usePlaybackTransportState must be used within a PlaybackTransportProvider');
  }
  return ctx;
}

export function usePlaybackTransportActions(): PlaybackTransportActions {
  const ctx = useContext(TransportActionsContext);
  if (!ctx) {
    throw new Error('usePlaybackTransportActions must be used within a PlaybackTransportProvider');
  }
  return ctx;
}
