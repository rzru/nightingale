import { useEffect, useRef, useState } from 'react';

import {
  microphoneAdapter,
  type MicCaptureOptions,
  type MicrophoneAdapter,
} from '@/bridge/microphone';
import { useMicSamples } from '@/features/microphone/hooks/use-mic-samples';
import { SampleRing } from '@/features/microphone/lib/sample-ring';
import { PITCH_RMS_GATE, PITCH_WINDOW_SAMPLES } from '@/features/playback/lib/pitch/constants';
import { createPitchDetector, detectPitchFromSamples } from '@/features/playback/lib/pitch/detect';

/** ~30 Hz pitch updates: more than enough for vocal pitch tracking. */
const PITCH_TICK_MS = 33;
const RING_CAPACITY = PITCH_WINDOW_SAMPLES * 2;
/**
 * A running microphone delivers audio continuously. No audio for this long
 * after it had started means the device is gone (unplugged, driver stopped).
 */
const MIC_STALL_MS = 1500;

const defaultAdapter = microphoneAdapter;

/** `rmsGate`: sound quieter than this is not treated as a voice. */
export function useMicPitch(captureId: string, enabled: boolean, rmsGate = PITCH_RMS_GATE) {
  const [latestPitch, setLatestPitch] = useState<number | null>(null);
  const [stalled, setStalled] = useState(false);
  const lastFrameAtRef = useRef<number | null>(null);
  const ringRef = useRef<SampleRing | null>(null);
  const sampleRateRef = useRef(0);

  if (ringRef.current === null) {
    ringRef.current = new SampleRing(RING_CAPACITY);
  }

  useMicSamples(
    captureId,
    (frame) => {
      sampleRateRef.current = frame.sample_rate;
      lastFrameAtRef.current = performance.now();
      ringRef.current?.push(frame.samples);
    },
    enabled,
  );

  useEffect(() => {
    if (!enabled) {
      ringRef.current?.reset();
      sampleRateRef.current = 0;
      return undefined;
    }

    const detector = createPitchDetector();
    const window = new Float32Array(PITCH_WINDOW_SAMPLES);

    const tick = () => {
      const lastFrameAt = lastFrameAtRef.current;
      setStalled(lastFrameAt !== null && performance.now() - lastFrameAt > MIC_STALL_MS);
      const ring = ringRef.current;
      const sr = sampleRateRef.current;
      if (!ring || sr === 0) {
        return;
      }
      if (!ring.readMostRecent(window)) {
        return;
      }
      const hz = detectPitchFromSamples(detector, window, sr, rmsGate);
      setLatestPitch(hz);
    };

    const id = setInterval(tick, PITCH_TICK_MS);

    return () => {
      clearInterval(id);
      lastFrameAtRef.current = null;
      setStalled(false);
    };
  }, [enabled, rmsGate]);

  const error: string | null = null;
  return {
    latestPitch: enabled ? latestPitch : null,
    active: enabled,
    /** The microphone stopped delivering audio while it should be running. */
    stalled: enabled && stalled,
    error,
  };
}

type MicCaptureInput = {
  captureId: string;
  deviceId: string | null;
  enabled: boolean;
  options: MicCaptureOptions;
};

export function useMicCapture(
  { captureId, deviceId, enabled, options }: MicCaptureInput,
  adapter: MicrophoneAdapter = defaultAdapter,
) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let cancelled = false;

    const run = async () => {
      try {
        await adapter.startCapture(captureId, deviceId, { emit_audio: false });

        if (cancelled) {
          return;
        }

        setActive(true);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          void adapter.stopCapture(captureId).catch(() => {});
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
          setActive(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      setActive(false);
      void adapter.stopCapture(captureId).catch(() => {});
    };
  }, [adapter, captureId, deviceId, enabled]);

  useEffect(() => {
    if (!enabled || !active) {
      return;
    }

    void adapter.setMonitoring(captureId, options.emit_audio).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [active, adapter, captureId, enabled, options.emit_audio]);

  return { active: enabled && active, error: enabled ? error : null };
}
