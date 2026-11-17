import type { RecordingFile } from '@/types/RecordingFile';
import type { SaveRecordingRequest } from '@/types/SaveRecordingRequest';

import { invoke, isTauri } from './runtime';

/** Recording runs in the desktop app, where the microphone is captured natively. */
export const recordingSupported = isTauri;

/** Arm recording of a microphone capture; fails when the disk is nearly full. */
export const beginRecording = async (captureId: string): Promise<void> => {
  await invoke<void>('recording_begin', { captureId });
};

/** The song plays from `songTimeSec`; the voice from now on belongs there. */
export const markRecording = async (songTimeSec: number): Promise<void> => {
  await invoke<void>('recording_mark', { songTimeSec });
};

/** The song is paused: stop writing until the next mark. */
export const holdRecording = async (): Promise<void> => {
  await invoke<void>('recording_hold');
};

/** Finish the take; returns its folder, or `null` when nothing was captured. */
export const endRecording = async (): Promise<string | null> =>
  await invoke<string | null>('recording_end');

export const cancelRecording = async (): Promise<void> => {
  await invoke<void>('recording_cancel');
};

/** Place the take on the song timeline; returns the voice track's path. */
export const renderRecordingVoice = async (take: string, offsetSec: number): Promise<string> =>
  await invoke<string>('render_recording_voice', { take, offsetSec });

/** Mix and save; returns the saved file's path. */
export const saveRecording = async (request: SaveRecordingRequest): Promise<string> =>
  await invoke<string>('save_recording', { request });

export const discardRecording = async (take: string): Promise<void> => {
  await invoke<void>('discard_recording', { take });
};

export const listRecordings = async (): Promise<RecordingFile[]> =>
  await invoke<RecordingFile[]>('list_recordings');

export const recordingsDir = async (): Promise<string> => await invoke<string>('recordings_dir');

export const deleteRecording = async (path: string): Promise<void> => {
  await invoke<void>('delete_recording', { path });
};
