import type { MediaEndpoint } from '@/types/MediaEndpoint';
import type { AudioPaths } from '@/types/Transcript';

import {
  ensureMp3Stems as tauriEnsureMp3Stems,
  ensurePlayableSourceVideo as tauriEnsurePlayableSourceVideo,
  exportLibraryNge as tauriExportLibraryNge,
  exportSongNge as tauriExportSongNge,
  fetchPixabayVideos as tauriFetchPixabayVideos,
  getAudioPaths as tauriRawGetAudioPaths,
  getMediaEndpoint as tauriGetMediaEndpoint,
  loadTranscript as tauriLoadTranscript,
  onLibraryExportDone as tauriOnLibraryExportDone,
  onPixabayVideoDownloaded as tauriOnPixabayVideoDownloaded,
  onStemsReady as tauriOnStemsReady,
} from './playback.tauri';
import { isTauri } from './runtime';

export type { LibraryExportDone, PixabayVideoDownloaded, StemsReadyEvent } from './playback.tauri';

export type PlaybackAdapter = {
  /**
   * Performs any one-time async setup (e.g. fetching the Tauri media port).
   * Must be awaited before `toMediaUrl` is called synchronously.
   */
  init(): Promise<void>;
  /** Build a fetchable URL for an absolute filesystem path returned by core. */
  toMediaUrl(absolutePath: string): string;
  /** Stem URLs for a song, already encoded for the active transport. */
  getAudioPaths(fileHash: string): Promise<AudioPaths>;
};

// ─── Tauri implementation ─────────────────────────────────────────────────
//
// The local media server gates every request behind a per-process session
// token embedded in the URL (`/s/<token>/local/<path>`), so any localhost
// process or web page that lacks the token cannot read files off it. The
// endpoint is baked into the page via the init script (see
// `client/src-tauri/src/lib.rs`), with an IPC fallback for hot-reload.

let cachedEndpoint: MediaEndpoint | null = null;

const ensureEndpoint = async (): Promise<MediaEndpoint> => {
  if (cachedEndpoint) {
    return cachedEndpoint;
  }
  cachedEndpoint = window.__NIGHTINGALE_MEDIA_ENDPOINT__ ?? (await tauriGetMediaEndpoint());
  return cachedEndpoint;
};

const tauriToMediaUrl = (absolutePath: string): string => {
  if (cachedEndpoint === null) {
    throw new Error('playbackAdapter.init() must be awaited before toMediaUrl');
  }
  const { port, session_token } = cachedEndpoint;
  return `http://127.0.0.1:${port}/s/${session_token}/local/${encodeURIComponent(absolutePath)}`;
};

export const tauriPlaybackAdapter: PlaybackAdapter = {
  async init() {
    await ensureEndpoint();
  },
  toMediaUrl: tauriToMediaUrl,
  async getAudioPaths(fileHash) {
    await ensureEndpoint();
    const paths = await tauriRawGetAudioPaths(fileHash);
    return {
      instrumental: tauriToMediaUrl(paths.instrumental),
      vocals: paths.vocals === null ? null : tauriToMediaUrl(paths.vocals),
    };
  },
};

// ─── Web implementation ───────────────────────────────────────────────────

/**
 * Wraps a server-side absolute path in the asset proxy so the browser can
 * fetch it through the same origin without leaking filesystem layout. The
 * server canonicalises and rejects anything outside the data dir.
 */
const webToMediaUrl = (absolutePath: string): string =>
  `/api/asset?path=${encodeURIComponent(absolutePath)}`;

export const webPlaybackAdapter: PlaybackAdapter = {
  async init() {
    // Nothing to do; the server lives at the page origin.
  },
  toMediaUrl: webToMediaUrl,
  async getAudioPaths(fileHash) {
    // Resolve the server-side path so the URL encodes the active key/tempo
    // variant. A stable `/media/<hash>/<kind>` route would let the browser
    // cache the response and replay the original stems after a shift.
    const paths = await tauriRawGetAudioPaths(fileHash);
    return {
      instrumental: webToMediaUrl(paths.instrumental),
      vocals: paths.vocals === null ? null : webToMediaUrl(paths.vocals),
    };
  },
};

export const playbackAdapter: PlaybackAdapter = isTauri ? tauriPlaybackAdapter : webPlaybackAdapter;

// ─── Re-exports for command/event call sites ─────────────────────────────

export const loadTranscript = tauriLoadTranscript;
export const ensureMp3Stems = tauriEnsureMp3Stems;
export const ensurePlayableSourceVideo = tauriEnsurePlayableSourceVideo;
export const exportSongNge = tauriExportSongNge;
export const exportLibraryNge = tauriExportLibraryNge;
export const onLibraryExportDone = tauriOnLibraryExportDone;
export const fetchPixabayVideos = tauriFetchPixabayVideos;
export const onStemsReady = tauriOnStemsReady;
export const onPixabayVideoDownloaded = tauriOnPixabayVideoDownloaded;
