import type { MediaEndpoint } from '@/types/MediaEndpoint';
import type { AudioPaths, Transcript } from '@/types/Transcript';

import { invoke, listen, type UnlistenFn } from './runtime';

export const loadTranscript = async (fileHash: string): Promise<Transcript> => {
  return await invoke<Transcript>('load_transcript', { fileHash });
};

export const getAudioPaths = async (fileHash: string): Promise<AudioPaths> => {
  return await invoke<AudioPaths>('get_audio_paths', { fileHash });
};

export const ensureMp3Stems = (fileHash: string): void => {
  void invoke<void>('ensure_mp3_stems', { fileHash });
};

export const ensurePlayableSourceVideo = async (fileHash: string): Promise<string | null> => {
  return await invoke<string | null>('ensure_playable_source_video', { fileHash });
};

/** Export an analyzed local song to a `.nge` bundle in `destDir`; resolves to
 * the absolute path of the written file. */
export const exportSongNge = async (fileHash: string, destDir: string): Promise<string> => {
  return await invoke<string>('export_song_nge', { fileHash, destDir });
};

export type LibraryExportDone = {
  ok: boolean;
  exported: number;
  skipped: number;
  failed: number;
  error: string | null;
};

/** Kick off exporting the whole library to `.nge` bundles in `destDir`. Runs in
 * the background; completion is delivered via `onLibraryExportDone`. */
export const exportLibraryNge = (destDir: string): void => {
  void invoke<void>('export_library_nge', { destDir });
};

export const onLibraryExportDone = async (
  cb: (event: LibraryExportDone) => void,
): Promise<UnlistenFn> => {
  return await listen<LibraryExportDone>('library-export-done', ({ payload }) => cb(payload));
};

export type StemsReadyEvent = {
  file_hash: string;
  error: string | null;
};

export const onStemsReady = async (cb: (event: StemsReadyEvent) => void): Promise<UnlistenFn> => {
  return await listen<StemsReadyEvent>('stems-ready', ({ payload }) => cb(payload));
};

export const fetchPixabayVideos = async (flavor: string): Promise<string[]> => {
  return await invoke<string[]>('fetch_pixabay_videos', { flavor });
};

export const getMediaEndpoint = async (): Promise<MediaEndpoint> => {
  return await invoke<MediaEndpoint>('get_media_endpoint');
};

export type PixabayVideoDownloaded = {
  flavor: string;
  path: string;
  evictedPath?: string;
};

export const onPixabayVideoDownloaded = async (
  cb: (event: PixabayVideoDownloaded) => void,
): Promise<UnlistenFn> => {
  return await listen<{ flavor: string; path: string; evicted_path: string | null }>(
    'pixabay-video-downloaded',
    ({ payload }) =>
      cb({
        flavor: payload.flavor,
        path: payload.path,
        evictedPath: payload.evicted_path ?? undefined,
      }),
  );
};
