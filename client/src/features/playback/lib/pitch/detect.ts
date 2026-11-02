import { PitchDetector } from 'pitchy';

import {
  MAX_PITCH_HZ,
  MIN_PITCH_HZ,
  PITCH_CLARITY_THRESHOLD,
  PITCH_RMS_GATE,
  PITCH_WINDOW_SAMPLES,
} from './constants';

function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    sum += s * s;
  }
  return Math.sqrt(sum / samples.length);
}

export function createPitchDetector(): PitchDetector<Float32Array> {
  return PitchDetector.forFloat32Array(PITCH_WINDOW_SAMPLES);
}

export function detectPitchFromSamples(
  detector: PitchDetector<Float32Array>,
  samples: Float32Array,
  sampleRate: number,
): number | null {
  if (samples.length !== PITCH_WINDOW_SAMPLES) {
    throw new Error(`Expected ${PITCH_WINDOW_SAMPLES} samples`);
  }
  if (rms(samples) < PITCH_RMS_GATE) {
    return null;
  }
  const [hz, clarity] = detector.findPitch(samples, sampleRate);
  if (hz <= 0 || clarity < PITCH_CLARITY_THRESHOLD) {
    return null;
  }
  if (hz < MIN_PITCH_HZ || hz > MAX_PITCH_HZ) {
    return null;
  }
  return hz;
}
