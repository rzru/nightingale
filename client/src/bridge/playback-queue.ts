import { z } from 'zod';

import { invoke, listen, type UnlistenFn } from './runtime';
import { songSchema } from './schemas';

const playbackQueueEntrySchema = z.object({
  id: z.string(),
  song: songSchema,
  tempo: z.number(),
  keyOffset: z.number(),
});
const playbackQueueSchema = z.array(playbackQueueEntrySchema);

export type PlaybackQueueEntry = z.infer<typeof playbackQueueEntrySchema>;

const parseQueue = (value: unknown): PlaybackQueueEntry[] => playbackQueueSchema.parse(value);

export const loadPlaybackQueue = async (): Promise<PlaybackQueueEntry[]> =>
  parseQueue(await invoke('load_playback_queue'));

export const addPlaybackQueueEntry = async (
  fileHash: string,
  tempo: number,
  keyOffset: number,
  addToFront = false,
): Promise<PlaybackQueueEntry[]> =>
  parseQueue(await invoke('add_playback_queue_entry', { fileHash, tempo, keyOffset, addToFront }));

export const movePlaybackQueueEntry = async (
  id: string,
  targetIndex: number,
): Promise<PlaybackQueueEntry[]> =>
  parseQueue(await invoke('move_playback_queue_entry', { id, targetIndex }));

export const removePlaybackQueueEntry = async (id: string): Promise<PlaybackQueueEntry[]> =>
  parseQueue(await invoke('remove_playback_queue_entry', { id }));

export const clearPlaybackQueue = async (): Promise<PlaybackQueueEntry[]> =>
  parseQueue(await invoke('clear_playback_queue'));

export const onPlaybackQueueChanged = async (
  callback: (entries: PlaybackQueueEntry[]) => void,
): Promise<UnlistenFn> =>
  await listen<unknown>('playback-queue-changed', ({ payload }) => callback(parseQueue(payload)));
