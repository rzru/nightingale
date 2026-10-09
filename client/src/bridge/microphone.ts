import type { MicCaptureOptions } from '@/types/MicCaptureOptions';
import type { MicrophoneInfo } from '@/types/MicrophoneInfo';
import type { MicSampleFrame } from '@/types/MicSampleFrame';

import type { MicSamplesCallback, StopListening } from './microphone-samples';
import { tauriMicrophoneAdapter } from './microphone.tauri';
import { setWebMicMonitorGain, webMicrophoneAdapter } from './microphone.web';
import { isTauri } from './runtime';

export type { MicSamplesCallback, StopListening } from './microphone-samples';
export type { MicCaptureOptions, MicSampleFrame };

export type MicrophoneAdapter = {
  listDevices(combineChannels: boolean): Promise<MicrophoneInfo[]>;
  startCapture(
    captureId: string,
    preferred: string | null,
    options: MicCaptureOptions,
  ): Promise<string>;
  stopCapture(captureId: string): Promise<void>;
  subscribe(captureId: string, cb: MicSamplesCallback): Promise<StopListening>;
};

export { tauriMicrophoneAdapter, webMicrophoneAdapter };

export const microphoneAdapter: MicrophoneAdapter = isTauri
  ? tauriMicrophoneAdapter
  : webMicrophoneAdapter;

export const listMicrophones = (combineChannels = true): Promise<MicrophoneInfo[]> =>
  microphoneAdapter.listDevices(combineChannels);

const DEFAULT_CAPTURE_ID = 'default';

export const startMicCapture = (
  preferred: string | null,
  options: MicCaptureOptions,
): Promise<string> => microphoneAdapter.startCapture(DEFAULT_CAPTURE_ID, preferred, options);

export const stopMicCapture = (): Promise<void> =>
  microphoneAdapter.stopCapture(DEFAULT_CAPTURE_ID);

/**
 * Pushes a new monitor gain to the active web capture. In Tauri the same value
 * is applied server-side from `save_config` via `set_monitor_gain`, so this
 * call is a no-op in that build.
 */
export const updateMicMonitorGain = (value: number): void => {
  if (isTauri) {
    return;
  }
  setWebMicMonitorGain(value);
};
