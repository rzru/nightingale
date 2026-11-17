import { PITCH_RMS_GATE } from './constants';

/**
 * Microphone sensitivity: sound quieter than the gate is not treated as a
 * voice. A higher gate ignores room noise and music from speakers, at the
 * cost of missing quiet singing.
 */
export type MicSensitivity = 'quiet' | 'normal' | 'noisy' | 'loud';

export const DEFAULT_MIC_SENSITIVITY: MicSensitivity = 'normal';

/** RMS level (0..1 of full scale) below which the microphone is silent. */
export const MIC_SENSITIVITY_GATE: Record<MicSensitivity, number> = {
  quiet: 0.003,
  normal: PITCH_RMS_GATE,
  noisy: 0.012,
  loud: 0.025,
};

/** Speakers instead of headphones: the song itself reaches the microphone. */
export const SPEAKER_MODE_GATE_FACTOR = 3;

const isMicSensitivity = (value: unknown): value is MicSensitivity =>
  value === 'quiet' || value === 'normal' || value === 'noisy' || value === 'loud';

export function micRmsGate(
  sensitivity: string | null | undefined,
  speakerMode: boolean | null | undefined,
): number {
  const gate = MIC_SENSITIVITY_GATE[isMicSensitivity(sensitivity) ? sensitivity : 'normal'];
  return speakerMode === true ? gate * SPEAKER_MODE_GATE_FACTOR : gate;
}
