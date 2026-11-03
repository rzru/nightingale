import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { microphoneAdapter, type StopListening } from '@/bridge/microphone';
import { t, tp } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { ButtonGroup } from '@/shared/components/ui/button-group';
import { Field } from '@/shared/components/ui/field';
import { Label } from '@/shared/components/ui/label';

import { Hint } from './settings-controls';

const MAX_RECORDING_MS = 5000;
const MAX_RECORDING_SECONDS = MAX_RECORDING_MS / 1000;
const CAPTURE_ID = 'microphone-test';

type MicRecording = {
  samples: Float32Array;
  sampleRate: number;
};

type MicPlayback = {
  context: AudioContext;
  source: AudioBufferSourceNode;
  onEnded: () => void;
};

type MicTestFieldProps = {
  selectedMicId: string | null;
  disabled?: boolean;
  startButtonClassName?: string;
  playButtonClassName?: string;
  onBusyChange?: (busy: boolean) => void;
  onCaptureStarted?: () => void;
};

export function MicTestField({
  selectedMicId,
  disabled = false,
  startButtonClassName,
  playButtonClassName,
  onBusyChange,
  onCaptureStarted,
}: MicTestFieldProps) {
  const [recording, setRecording] = useState<MicRecording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const recordingActiveRef = useRef(false);
  const chunksRef = useRef<number[][]>([]);
  const sampleCountRef = useRef(0);
  const sampleRateRef = useRef(0);
  const stopListeningRef = useRef<StopListening | null>(null);
  const timerRef = useRef<number | null>(null);
  const counterRef = useRef<number | null>(null);
  const playbackRef = useRef<MicPlayback | null>(null);

  const stopPlayback = useCallback(() => {
    const playback = playbackRef.current;
    playbackRef.current = null;
    if (!playback) {
      return;
    }
    playback.source.removeEventListener('ended', playback.onEnded);
    try {
      playback.source.stop();
    } catch {
      // The source may already have finished naturally.
    }
    void playback.context.close().catch(() => {});
    setIsPlaying(false);
  }, []);

  const finishRecording = useCallback(async () => {
    if (!recordingActiveRef.current) {
      return;
    }

    recordingActiveRef.current = false;
    setIsRecording(false);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (counterRef.current !== null) {
      window.clearInterval(counterRef.current);
      counterRef.current = null;
    }
    stopListeningRef.current?.();
    stopListeningRef.current = null;
    await microphoneAdapter.stopCapture(CAPTURE_ID).catch(() => {});

    const sampleRate = sampleRateRef.current;
    const sampleCount = sampleCountRef.current;
    if (sampleRate === 0 || sampleCount === 0) {
      toast.error(t('settings.micTestField.microphoneTestDidNotReceiveAnyAudio'));
      return;
    }

    const samples = new Float32Array(sampleCount);
    let offset = 0;
    for (const chunk of chunksRef.current) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    setRecording({ samples, sampleRate });
  }, []);

  const startRecording = useCallback(async () => {
    stopPlayback();
    setRecording(null);
    chunksRef.current = [];
    sampleCountRef.current = 0;
    sampleRateRef.current = 0;
    recordingActiveRef.current = true;
    setIsRecording(true);
    setRecordingSeconds(0);
    counterRef.current = window.setInterval(() => {
      setRecordingSeconds((seconds) => Math.min(seconds + 1, MAX_RECORDING_SECONDS));
    }, 1000);

    try {
      stopListeningRef.current = await microphoneAdapter.subscribe(CAPTURE_ID, (frame) => {
        if (!recordingActiveRef.current) {
          return;
        }

        if (sampleRateRef.current === 0) {
          sampleRateRef.current = frame.sample_rate;
        }
        const maxSamples = Math.ceil((sampleRateRef.current * MAX_RECORDING_MS) / 1000);
        const remaining = maxSamples - sampleCountRef.current;
        if (remaining <= 0) {
          void finishRecording();
          return;
        }

        const chunk = frame.samples.slice(0, remaining);
        chunksRef.current.push(chunk);
        sampleCountRef.current += chunk.length;
        if (sampleCountRef.current >= maxSamples) {
          void finishRecording();
        }
      });
      await microphoneAdapter.startCapture(CAPTURE_ID, selectedMicId, { emit_audio: false });
      onCaptureStarted?.();

      timerRef.current = window.setTimeout(() => void finishRecording(), MAX_RECORDING_MS);
    } catch (error) {
      recordingActiveRef.current = false;
      setIsRecording(false);
      window.clearInterval(counterRef.current);
      counterRef.current = null;
      stopListeningRef.current?.();
      stopListeningRef.current = null;
      await microphoneAdapter.stopCapture(CAPTURE_ID).catch(() => {});
      const message = error instanceof Error ? error.message : String(error);
      toast.error(t('settings.micTestField.microphoneTestFailed', { value1: message }));
    }
  }, [finishRecording, onCaptureStarted, selectedMicId, stopPlayback]);

  const playRecording = useCallback(async () => {
    if (!recording) {
      return;
    }

    stopPlayback();
    try {
      const context = new AudioContext();
      await context.resume();
      const buffer = context.createBuffer(1, recording.samples.length, recording.sampleRate);
      buffer.copyToChannel(recording.samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const onEnded = () => {
        if (playbackRef.current?.source !== source) {
          return;
        }
        playbackRef.current = null;
        void context.close().catch(() => {});
        setIsPlaying(false);
      };
      source.addEventListener('ended', onEnded, { once: true });
      playbackRef.current = { context, source, onEnded };
      setIsPlaying(true);
      source.start();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(t('settings.micTestField.couldNotPlayMicrophoneTest', { value1: message }));
      stopPlayback();
    }
  }, [recording, stopPlayback]);

  useEffect(() => {
    onBusyChange?.(isRecording || isPlaying);
  }, [isPlaying, isRecording, onBusyChange]);

  useEffect(
    () => () => {
      const captureActive = recordingActiveRef.current;
      recordingActiveRef.current = false;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      if (counterRef.current !== null) {
        window.clearInterval(counterRef.current);
      }
      stopListeningRef.current?.();
      if (captureActive) {
        void microphoneAdapter.stopCapture(CAPTURE_ID).catch(() => {});
      }
      const playback = playbackRef.current;
      if (playback) {
        playback.source.removeEventListener('ended', playback.onEnded);
        try {
          playback.source.stop();
        } catch {
          // The source may already have finished naturally.
        }
        void playback.context.close().catch(() => {});
      }
    },
    [],
  );

  return (
    <Field>
      <Label>{t('settings.micTestField.microphoneTest')}</Label>
      <Hint>
        {isRecording
          ? tp(
              'settings.microphone.recordingOne',
              'settings.microphone.recordingOther',
              recordingSeconds,
            )
          : t('settings.microphone.testDescription')}
      </Hint>
      <ButtonGroup>
        <Button
          variant={isRecording ? 'default' : 'outline'}
          disabled={disabled}
          onClick={() => void (isRecording ? finishRecording() : startRecording())}
          className={startButtonClassName}
        >
          {t(isRecording ? 'settings.microphone.stopTest' : 'settings.microphone.startTest')}
        </Button>
        <Button
          variant="outline"
          disabled={disabled || recording === null || isRecording || isPlaying}
          onClick={() => void playRecording()}
          className={playButtonClassName}
        >
          {t('common.actions.play')}
        </Button>
      </ButtonGroup>
    </Field>
  );
}
