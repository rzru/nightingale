import type { MicCaptureOptions } from '@/types/MicCaptureOptions';
import type { MicrophoneInfo } from '@/types/MicrophoneInfo';
import type { MicSampleFrame } from '@/types/MicSampleFrame';

import type { MicrophoneAdapter } from './microphone';
import { dispatchMicFrame, subscribeMicSamples } from './microphone-samples';
import { createChannel, invoke } from './runtime';

/**
 * Serializes start/stop so React's stop-then-start on song change can't race
 * at the Tauri IPC layer (commands run on a worker pool and would otherwise
 * be free to reorder).
 */
let opChain: Promise<unknown> = Promise.resolve();

const enqueue = <T>(op: () => Promise<T>): Promise<T> => {
  const next = opChain.catch(() => undefined).then(op);
  opChain = next;
  return next;
};

const listDevices = (combineChannels: boolean): Promise<MicrophoneInfo[]> =>
  invoke<MicrophoneInfo[]>('list_microphones', { combineChannels });

const startCapture = (
  captureId: string,
  preferred: string | null,
  options: MicCaptureOptions,
): Promise<string> =>
  enqueue(async () => {
    /**
     * Always allocate a fresh Channel: when Rust drops the previous one in
     * `stop_mic_capture` it sends an `end` message that unregisters the JS
     * callback id. Reusing the cached Channel would hand Rust a dead id and
     * spam "Couldn't find callback id ..." for every frame.
     */
    const channel = createChannel<MicSampleFrame>();
    channel.onmessage = (frame) => dispatchMicFrame(captureId, frame);
    return await invoke<string>('start_mic_capture', {
      captureId,
      preferred,
      options,
      onSamples: channel,
    });
  });

const stopCapture = (captureId: string): Promise<void> =>
  enqueue(async () => {
    await invoke('stop_mic_capture', { captureId });
  });

export const tauriMicrophoneAdapter: MicrophoneAdapter = {
  listDevices,
  startCapture,
  stopCapture,
  subscribe: async (captureId, callback) => subscribeMicSamples(captureId, callback),
};
