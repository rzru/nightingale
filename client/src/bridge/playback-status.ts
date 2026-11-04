import { z } from 'zod';

import { invoke, invokeOnUnload, listen, type UnlistenFn } from './runtime';
import {
  queuePlaybackRequestSchema,
  remoteMicrophonesSchema,
  type QueuePlaybackPlayer,
  type RemoteMicrophone,
} from './schemas';

export const PLAYBACK_COMMANDS = ['pause', 'resume', 'next', 'exit'] as const;

export type PlaybackCommand = (typeof PLAYBACK_COMMANDS)[number];

const playbackCommandSchema = z.enum(PLAYBACK_COMMANDS);

const playbackStatusSchema = z.object({
  active: z.boolean(),
  paused: z.boolean(),
  finished: z.boolean(),
  hasNext: z.boolean(),
  sessionPlayback: z.boolean(),
});

export type PlaybackStatus = z.infer<typeof playbackStatusSchema>;

export const loadPlaybackStatus = async (): Promise<PlaybackStatus> =>
  playbackStatusSchema.parse(await invoke('load_playback_status'));

/** Published by whichever surface owns the audio engine. */
export const setPlaybackStatus = async (status: PlaybackStatus): Promise<void> => {
  await invoke('set_playback_status', status);
};

/** Idle snapshot from a surface that is closing; still lands as its tab dies. */
export const setPlaybackStatusOnUnload = (status: PlaybackStatus): void => {
  invokeOnUnload('set_playback_status', status);
};

export const onPlaybackStatusChanged = async (
  callback: (status: PlaybackStatus) => void,
): Promise<UnlistenFn> =>
  await listen<unknown>('playback-status-changed', ({ payload }) =>
    callback(playbackStatusSchema.parse(payload)),
  );

/** Asks the playback surface to run an action. It decides how to run it. */
export const requestPlaybackCommand = async (command: PlaybackCommand): Promise<void> => {
  await invoke('request_playback_command', { command });
};

export const onPlaybackCommandRequested = async (
  callback: (command: PlaybackCommand) => void,
): Promise<UnlistenFn> =>
  await listen<unknown>('playback-command-requested', ({ payload }) => {
    const parsed = z.object({ command: playbackCommandSchema }).parse(payload);

    callback(parsed.command);
  });

/**
 * Asks the host to start the first queued song on its own playback surface,
 * optionally as named singers. The host resolves their microphones.
 *
 * The callback gets `null` when the host sent a lineup it cannot read, so the
 * caller can report it instead of silently starting a solo song.
 */
export const requestQueuePlayback = async (players: QueuePlaybackPlayer[] = []): Promise<void> => {
  await invoke('request_queue_playback', { players });
};

export const onQueuePlaybackRequested = async (
  callback: (players: QueuePlaybackPlayer[] | null) => void,
): Promise<UnlistenFn> =>
  await listen<unknown>('playback-queue-play-requested', ({ payload }) => {
    const parsed = queuePlaybackRequestSchema.safeParse(payload);

    callback(parsed.success ? parsed.data.players : null);
  });

/** The host publishes its microphones so a phone can offer them as singers. */
export const saveRemoteMicrophones = async (microphones: RemoteMicrophone[]): Promise<void> => {
  await invoke('set_remote_microphones', { microphones });
};

export const loadRemoteMicrophones = async (): Promise<RemoteMicrophone[]> =>
  remoteMicrophonesSchema.parse(await invoke('load_remote_microphones'));
