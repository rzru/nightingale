import { z } from 'zod';

import type { AppConfig } from '@/types/AppConfig';
import type { CachePaths } from '@/types/CachePaths';
import type { LibrarySource } from '@/types/LibrarySource';
import type { Song } from '@/types/Song';
import type { SongOrigin } from '@/types/SongOrigin';
import type { SongsMeta } from '@/types/SongsMeta';
import type { UsdxBundle } from '@/types/UsdxBundle';

const nullableString = z.string().nullable();
const nullableNumber = z.number().nullable();
const nullableBoolean = z.boolean().nullable();

const cachePathsSchema: z.ZodType<CachePaths> = z.object({
  songs: nullableString,
  videos: nullableString,
  models: nullableString,
  vendor: nullableString,
});

const backgroundSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('built_in_shader'), id: z.string() }),
  z.object({ kind: z.literal('pixabay') }),
  z.object({ kind: z.literal('custom'), id: z.string() }),
]);

const customBackgroundSchema = z.object({
  id: z.string(),
  name: z.string(),
  background_type: z.enum(['image', 'shader', 'video']),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('managed'), file_name: z.string() }),
    z.object({ kind: z.literal('url'), url: z.string() }),
  ]),
});

const librarySourceSchema: z.ZodType<LibrarySource> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('folder'), path: z.string() }),
  z.object({
    kind: z.literal('jellyfin'),
    base_url: z.string(),
    user_id: z.string(),
    username: z.string(),
    access_token: z.string(),
    device_id: z.string(),
    library_ids: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('navidrome'),
    base_url: z.string(),
    username: z.string(),
    password: z.string(),
  }),
  z.object({
    kind: z.literal('plex'),
    base_url: z.string(),
    server_name: z.string(),
    machine_id: z.string(),
    username: z.string(),
    access_token: z.string(),
    client_id: z.string(),
    section_ids: z.array(z.string()),
  }),
]);

export const appConfigSchema: z.ZodType<AppConfig> = z.object({
  data_path: nullableString,
  cache_paths: cachePathsSchema.nullable(),
  last_folder: nullableString,
  library_source: librarySourceSchema.nullable(),
  last_theme: nullableNumber,
  custom_backgrounds: z.array(customBackgroundSchema),
  last_background: backgroundSelectionSchema.nullable(),
  guide_volume: nullableNumber,
  master_volume: nullableNumber,
  fullscreen: nullableBoolean,
  playback_mode: nullableString,
  dark_mode: nullableBoolean,
  mic_active: nullableBoolean,
  mic_monitoring: nullableBoolean,
  mic_monitor_gain: nullableNumber,
  mic_latency_compensation_sec: nullableNumber,
  preferred_mic: nullableString,
  whisper_model: nullableString,
  beam_size: nullableNumber,
  batch_size: nullableNumber,
  last_video_flavor: nullableNumber,
  lyrics_vertical_position: nullableString,
  lyrics_horizontal_position: nullableString,
  lyrics_scale: nullableNumber,
  pitch_graph_scale: nullableNumber,
  lyrics_romanization_mode: nullableString,
  separator: nullableString,
  asr_engine: nullableString,
  align_backend: nullableString,
  vocal_detection_threshold_pct: nullableNumber,
  auto_analyze: nullableBoolean,
  export_audio_codec: nullableString,
  deep_link_allowed_hosts: z.array(z.string()).nullable(),
  song_list_view: nullableString,
  song_list_sort: z
    .array(
      z.object({
        column: z.enum(['title', 'artist', 'album', 'duration', 'status']),
        direction: z.enum(['ascending', 'descending']),
      }),
    )
    .nullable(),
  language_overrides: z.record(z.string(), z.string()).nullable(),
});

export const songsMetaSchema: z.ZodType<SongsMeta> = z.object({
  count: z.number(),
  folder: z.string(),
  processed_count: z.number(),
  songs_count: z.number(),
  videos_count: z.number(),
  analyzed_count: z.number(),
});

const usdxBundleSchema: z.ZodType<UsdxBundle> = z.object({
  txt_path: z.string(),
  audio: z.string(),
  vocals: nullableString,
  instrumental: nullableString,
  video: nullableString,
});

const songOriginSchema: z.ZodType<SongOrigin> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local_file') }),
  z.object({
    kind: z.literal('jellyfin'),
    item_id: z.string(),
    container: nullableString,
    cover_tag: nullableString,
  }),
  z.object({
    kind: z.literal('navidrome'),
    item_id: z.string(),
    container: nullableString,
    cover_tag: nullableString,
  }),
  z.object({
    kind: z.literal('plex'),
    item_id: z.string(),
    part_key: z.string(),
    container: nullableString,
    cover_tag: nullableString,
  }),
]);

export const songSchema: z.ZodType<Song> = z.object({
  path: z.string(),
  file_hash: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  duration_secs: z.number(),
  album_art_path: nullableString,
  is_analyzed: z.boolean(),
  language: nullableString,
  transcript_source: z.enum(['Lyrics', 'Generated', 'Usdx', 'Lrc']).nullable(),
  key: nullableString,
  override_key: nullableString,
  tempo: z.number(),
  key_offset: z.number(),
  is_video: z.boolean(),
  usdx: usdxBundleSchema.nullable(),
  origin: songOriginSchema,
  no_stems: z.boolean(),
});

export const webBootstrapSchema = z.object({
  config: appConfigSchema,
  songsMeta: songsMetaSchema,
  dataPathPinned: z.boolean().optional(),
  libraryPinned: z.boolean().optional(),
});

export const playbackPlayerSchema = z.object({
  id: z.string().min(1),
  profile: z.string().min(1).nullable(),
  microphoneId: z.string().min(1),
});

export const playbackPlayersSchema = z
  .array(playbackPlayerSchema)
  .min(2)
  .max(4)
  .superRefine((players, context) => {
    const playerIds = new Set(players.map((player) => player.id));
    const microphoneIds = new Set(players.map((player) => player.microphoneId));
    const profiles = players.flatMap((player) => (player.profile === null ? [] : [player.profile]));
    if (playerIds.size !== players.length) {
      context.addIssue({ code: 'custom', message: 'Multiplayer player IDs must be unique' });
    }
    if (microphoneIds.size !== players.length) {
      context.addIssue({ code: 'custom', message: 'Multiplayer microphones must be unique' });
    }
    if (new Set(profiles).size !== profiles.length) {
      context.addIssue({ code: 'custom', message: 'Multiplayer profiles must be unique' });
    }
  });

export const playbackLocationStateSchema = z.object({
  song: songSchema,
  queuePlayback: z.boolean().optional(),
  playbackId: z.string().optional(),
  players: playbackPlayersSchema.optional(),
});
