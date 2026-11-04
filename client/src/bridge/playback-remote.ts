import { z } from 'zod';

import { invoke, listen, type UnlistenFn } from './runtime';
import { remoteMicrophonesSchema } from './schemas';

const playbackProgressSchema = z.object({
  active: z.boolean(),
  playing: z.boolean(),
  paused: z.boolean(),
  finished: z.boolean(),
  hasNext: z.boolean(),
  sessionPlayback: z.boolean(),
  positionMs: z.number(),
  durationMs: z.number(),
  skipIntro: z.boolean(),
  skipOutro: z.boolean(),
  previousLineMs: z.number().nullable(),
  nextLineMs: z.number().nullable(),
});

export type PlaybackProgress = z.infer<typeof playbackProgressSchema>;

const remoteOptionSchema = z.object({
  key: z.string(),
  label: z.string(),
});

const playbackOptionsSchema = z.object({
  guideVolume: z.number(),
  guideAvailable: z.boolean(),
  multiplayer: z.boolean(),
  micEnabled: z.boolean(),
  micMonitorEnabled: z.boolean(),
  selectedMicId: z.string().nullable(),
  microphones: remoteMicrophonesSchema,
  themes: z.array(remoteOptionSchema),
  themeKey: z.string(),
  flavors: z.array(remoteOptionSchema),
  flavorKey: z.string(),
  flavorAvailable: z.boolean(),
});

export type PlaybackOptions = z.infer<typeof playbackOptionsSchema>;

/** Actions the phone may ask the host playback surface to run. */
const playbackControlSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('seek'), positionMs: z.number() }),
  z.object({ type: z.literal('skip-intro') }),
  z.object({ type: z.literal('skip-outro') }),
  z.object({ type: z.literal('set-guide-volume'), volume: z.number() }),
  z.object({ type: z.literal('toggle-mic') }),
  z.object({ type: z.literal('select-mic'), deviceId: z.string() }),
  z.object({ type: z.literal('toggle-monitoring') }),
  z.object({ type: z.literal('select-theme'), key: z.string() }),
  z.object({ type: z.literal('select-flavor'), key: z.string() }),
]);

export type PlaybackControl = z.infer<typeof playbackControlSchema>;

export const loadPlaybackProgress = async (): Promise<PlaybackProgress> =>
  playbackProgressSchema.parse(await invoke('load_playback_progress'));

export const loadPlaybackOptions = async (): Promise<PlaybackOptions> =>
  playbackOptionsSchema.parse(await invoke('load_playback_options'));

export const onPlaybackProgressChanged = async (
  callback: (progress: PlaybackProgress) => void,
): Promise<UnlistenFn> =>
  await listen<unknown>('playback-progress-changed', ({ payload }) =>
    callback(playbackProgressSchema.parse(payload)),
  );

export const onPlaybackOptionsChanged = async (
  callback: (options: PlaybackOptions) => void,
): Promise<UnlistenFn> =>
  await listen<unknown>('playback-options-changed', ({ payload }) =>
    callback(playbackOptionsSchema.parse(payload)),
  );

/** Published by whichever surface owns the audio engine. */
export const savePlaybackProgress = async (progress: PlaybackProgress): Promise<void> => {
  await invoke('set_playback_progress', progress);
};

export const savePlaybackOptions = async (options: PlaybackOptions): Promise<void> => {
  await invoke('set_playback_options', options);
};

export const requestPlaybackControl = async (control: PlaybackControl): Promise<void> => {
  await invoke('request_playback_control', control);
};

export const onPlaybackControlRequested = async (
  callback: (control: PlaybackControl) => void,
): Promise<UnlistenFn> =>
  await listen<unknown>('playback-control-requested', ({ payload }) =>
    callback(playbackControlSchema.parse(payload)),
  );
