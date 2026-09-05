import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { microphoneAdapter } from '@/bridge/microphone';
import { saveRecording } from '@/bridge/recording';
import {
  usePlaybackMicActions,
  usePlaybackMicState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import { useCurrentProfile } from '@/features/profiles/hooks/use-current-profile';
import type { MicSampleFrame } from '@/types/MicSampleFrame';
import type { Song } from '@/types/Song';

const AUDIO_BITS_PER_SECOND = 256_000;
const MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
] as const;

export type RecordingPhase = 'idle' | 'preparing' | 'recording' | 'paused' | 'saving';

const supportedMimeType = (): string | null => {
  if (typeof MediaRecorder === 'undefined') {
    return null;
  }

  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
};

const stopRecorder = (recorder: MediaRecorder): void => {
  if (recorder.state !== 'inactive') {
    recorder.stop();
  }
};

type MicrophoneRecording = {
  chunks: Int16Array[];
  sampleCount: number;
  sampleRate: number;
};

type ActiveRecording = {
  recorder: MediaRecorder;
  chunks: Blob[];
  stopMicSubscription: () => void;
  microphone: MicrophoneRecording;
};

const pcm16Chunk = (samples: number[]): Int16Array =>
  Int16Array.from(samples, (sample) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    return Math.round(clamped < 0 ? clamped * 32_768 : clamped * 32_767);
  });

const writeWaveHeader = (view: DataView, sampleRate: number, sampleCount: number): void => {
  const writeText = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  const dataBytes = sampleCount * Int16Array.BYTES_PER_ELEMENT;

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * Int16Array.BYTES_PER_ELEMENT, true);
  view.setUint16(32, Int16Array.BYTES_PER_ELEMENT, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, dataBytes, true);
};

const microphoneWave = (recording: MicrophoneRecording): Blob | null => {
  if (recording.sampleRate <= 0 || recording.sampleCount === 0) {
    return null;
  }

  const buffer = new ArrayBuffer(44 + recording.sampleCount * Int16Array.BYTES_PER_ELEMENT);
  const view = new DataView(buffer);
  writeWaveHeader(view, recording.sampleRate, recording.sampleCount);

  let offset = 44;
  for (const chunk of recording.chunks) {
    for (const sample of chunk) {
      view.setInt16(offset, sample, true);
      offset += Int16Array.BYTES_PER_ELEMENT;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
};

const timestampPart = (value: number): string => value.toString().padStart(2, '0');

const recordingTimestamp = (): string => {
  const now = new Date();

  return `${timestampPart(now.getMonth() + 1)}-${timestampPart(now.getDate())}-${timestampPart(now.getFullYear() % 100)} ${timestampPart(now.getHours())}-${timestampPart(now.getMinutes())}-${timestampPart(now.getSeconds())}`;
};

export function usePlaybackRecording(song: Song, recordingsPath: string | null) {
  const currentProfile = useCurrentProfile();
  const { isReady, isFinished, paused: playbackPaused } = usePlaybackTransportState();
  const { getRecordingTarget } = usePlaybackTransportActions();
  const { micUserEnabled, micCaptureError } = usePlaybackMicState();
  const { setRecordingCaptureRequested } = usePlaybackMicActions();

  const [phase, setPhase] = useState<RecordingPhase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const phaseRef = useRef<RecordingPhase>('idle');
  const activeRef = useRef<ActiveRecording | null>(null);
  const discardRef = useRef(false);
  const showDiscardNoticeRef = useRef(false);
  const mountedRef = useRef(true);
  const elapsedBeforeRunRef = useRef(0);
  const runStartedAtRef = useRef(0);
  const pausedByPlaybackRef = useRef(false);

  const updatePhase = useCallback((next: RecordingPhase) => {
    phaseRef.current = next;
    if (mountedRef.current) {
      setPhase(next);
    }
  }, []);

  const stopMicCapture = useCallback(() => {
    const active = activeRef.current;
    if (!active) {
      return;
    }

    active.stopMicSubscription();
  }, []);

  const reset = useCallback(() => {
    activeRef.current = null;
    elapsedBeforeRunRef.current = 0;
    runStartedAtRef.current = 0;
    pausedByPlaybackRef.current = false;
    if (mountedRef.current) {
      setElapsedMs(0);
    }
    updatePhase('idle');
  }, [updatePhase]);

  const finish = useCallback(
    (discard: boolean) => {
      const active = activeRef.current;
      if (!active || (phaseRef.current !== 'recording' && phaseRef.current !== 'paused')) {
        return;
      }

      if (phaseRef.current === 'recording' && !pausedByPlaybackRef.current) {
        elapsedBeforeRunRef.current += performance.now() - runStartedAtRef.current;
      }
      discardRef.current = discard;
      showDiscardNoticeRef.current = discard;
      stopMicCapture();
      setRecordingCaptureRequested(false);
      updatePhase(discard ? 'idle' : 'saving');
      stopRecorder(active.recorder);
    },
    [setRecordingCaptureRequested, stopMicCapture, updatePhase],
  );

  const captureMicFrame = useCallback((frame: MicSampleFrame) => {
    const active = activeRef.current;
    if (!active || active.recorder.state !== 'recording') {
      return;
    }
    if (frame.sample_rate <= 0 || frame.samples.length === 0) {
      return;
    }
    if (active.microphone.sampleRate === 0) {
      active.microphone.sampleRate = frame.sample_rate;
    }
    if (active.microphone.sampleRate !== frame.sample_rate) {
      return;
    }

    const chunk = pcm16Chunk(frame.samples);
    active.microphone.chunks.push(chunk);
    active.microphone.sampleCount += chunk.length;
  }, []);

  const startRecorder = useCallback(async () => {
    const target = getRecordingTarget();
    const mimeType = supportedMimeType();
    if (target === null || mimeType === null) {
      const message = 'Audio recording is not supported on this device';
      setRecordingCaptureRequested(false);
      reset();
      setErrorMessage(message);
      toast.error(message);
      return;
    }

    const recorder = new MediaRecorder(target.destination.stream, {
      mimeType,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    });
    const chunks: Blob[] = [];
    const microphone: MicrophoneRecording = { chunks: [], sampleCount: 0, sampleRate: 0 };
    const stopMicSubscription = await microphoneAdapter.subscribe(captureMicFrame);

    if (phaseRef.current !== 'preparing') {
      stopMicSubscription();
      return;
    }

    activeRef.current = { recorder, chunks, stopMicSubscription, microphone };
    discardRef.current = false;

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    });
    recorder.addEventListener(
      'error',
      () => {
        const message = 'The recording stopped because the audio encoder failed';
        discardRef.current = true;
        showDiscardNoticeRef.current = false;
        stopMicCapture();
        setRecordingCaptureRequested(false);
        reset();
        setErrorMessage(message);
        toast.error(message);
      },
      { once: true },
    );
    recorder.addEventListener(
      'stop',
      () => {
        const discarded = discardRef.current;
        const audio = new Blob(chunks, { type: recorder.mimeType });
        const microphoneAudio = microphoneWave(microphone);
        activeRef.current = null;

        if (discarded) {
          reset();
          if (showDiscardNoticeRef.current) {
            toast('Recording discarded');
          }
          return;
        }

        void saveRecording({
          title: song.title,
          album: song.album,
          profile: currentProfile ?? 'No profile',
          savedAt: recordingTimestamp(),
          mediaType: recorder.mimeType,
          audio,
          microphoneAudio,
        })
          .then((fileName) => toast.success(`Recording saved as ${fileName}`))
          .catch((error: unknown) => {
            const message = `Could not save recording: ${error instanceof Error ? error.message : String(error)}`;
            if (mountedRef.current) {
              setErrorMessage(message);
            }
            toast.error(message);
          })
          .finally(reset);
      },
      { once: true },
    );

    recorder.start(1_000);
    elapsedBeforeRunRef.current = 0;
    runStartedAtRef.current = performance.now();
    updatePhase('recording');
  }, [
    getRecordingTarget,
    reset,
    captureMicFrame,
    currentProfile,
    setRecordingCaptureRequested,
    song,
    stopMicCapture,
    updatePhase,
  ]);

  const start = useCallback(() => {
    if (!isReady || phaseRef.current !== 'idle') {
      return;
    }
    if (recordingsPath === null || recordingsPath === '') {
      toast.error('Choose a recordings folder in Playback settings first');
      return;
    }
    if (!micUserEnabled) {
      toast.error('Turn the microphone on before recording');
      return;
    }

    setErrorMessage(null);
    setRecordingCaptureRequested(true);
    updatePhase('preparing');
    void startRecorder().catch((error: unknown) => {
      const message = `Could not start recording: ${error instanceof Error ? error.message : String(error)}`;
      setRecordingCaptureRequested(false);
      reset();
      if (mountedRef.current) {
        setErrorMessage(message);
      }
      toast.error(message);
    });
  }, [
    isReady,
    micUserEnabled,
    recordingsPath,
    reset,
    setRecordingCaptureRequested,
    startRecorder,
    updatePhase,
  ]);

  const togglePause = useCallback(() => {
    const active = activeRef.current;
    if (!active || playbackPaused) {
      return;
    }

    if (phaseRef.current === 'recording') {
      pausedByPlaybackRef.current = false;
      active.recorder.pause();
      elapsedBeforeRunRef.current += performance.now() - runStartedAtRef.current;
      setElapsedMs(elapsedBeforeRunRef.current);
      updatePhase('paused');
      return;
    }

    if (phaseRef.current === 'paused') {
      pausedByPlaybackRef.current = false;
      active.recorder.resume();
      runStartedAtRef.current = performance.now();
      updatePhase('recording');
    }
  }, [playbackPaused, updatePhase]);

  useEffect(() => {
    const active = activeRef.current;
    if (!active) {
      return;
    }

    if (playbackPaused && phaseRef.current === 'recording') {
      pausedByPlaybackRef.current = true;
      active.recorder.pause();
      elapsedBeforeRunRef.current += performance.now() - runStartedAtRef.current;
      return;
    }

    if (!playbackPaused && phaseRef.current === 'recording' && pausedByPlaybackRef.current) {
      pausedByPlaybackRef.current = false;
      active.recorder.resume();
      runStartedAtRef.current = performance.now();
    }
  }, [playbackPaused]);

  useEffect(() => {
    if (
      (phase !== 'preparing' && phase !== 'recording' && phase !== 'paused') ||
      typeof micCaptureError !== 'string' ||
      micCaptureError === ''
    ) {
      return;
    }

    const message = `Could not record the microphone: ${micCaptureError}`;
    if (phase === 'recording' || phase === 'paused') {
      finish(true);
      showDiscardNoticeRef.current = false;
    } else {
      setRecordingCaptureRequested(false);
      reset();
    }
    if (mountedRef.current) {
      setErrorMessage(message);
    }
    toast.error(message);
  }, [finish, micCaptureError, phase, reset, setRecordingCaptureRequested]);

  useEffect(() => {
    if (phase !== 'recording' || playbackPaused) {
      return undefined;
    }

    const updateElapsed = () => {
      setElapsedMs(elapsedBeforeRunRef.current + performance.now() - runStartedAtRef.current);
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 200);

    return () => window.clearInterval(timer);
  }, [phase, playbackPaused]);

  useEffect(() => {
    if (isFinished) {
      finish(false);
    }
  }, [finish, isFinished]);

  useEffect(() => {
    if (!micUserEnabled) {
      finish(false);
    }
  }, [finish, micUserEnabled]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      const active = activeRef.current;
      if (active && (phaseRef.current === 'recording' || phaseRef.current === 'paused')) {
        discardRef.current = false;
        stopMicCapture();
        setRecordingCaptureRequested(false);
        stopRecorder(active.recorder);
      }
    };
  }, [setRecordingCaptureRequested, stopMicCapture]);

  const displayedPhase = playbackPaused && phase === 'recording' ? 'paused' : phase;

  return {
    phase: displayedPhase,
    elapsedMs,
    errorMessage,
    canStart: isReady && micUserEnabled && recordingsPath !== null && recordingsPath !== '',
    micUserEnabled,
    start,
    togglePause,
    stop: () => finish(false),
    discard: () => finish(true),
  };
}
