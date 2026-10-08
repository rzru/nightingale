import { invoke, listen, type UnlistenFn } from './runtime';

export type DownloadProgress = { received: number; total: number | null };
export type DownloadDone = { ok: boolean; path: string | null; error: string | null };

/** The raw `nightingale://…` URL the app was cold-started with, if any. */
export const getInitialDeepLink = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.__NIGHTINGALE_INITIAL_DEEP_LINK__ ?? null;
};

/** Fires when a `nightingale://…` link is opened while the app is running. */
export const onDeepLinkDownload = async (cb: (url: string) => void): Promise<UnlistenFn> => {
  return await listen<string>('deep-link-download', ({ payload }) => cb(payload));
};

/** Start downloading a song (`.nge` or audio) into the library. Progress and
 * completion arrive via `onDownloadProgress` / `onDownloadDone`. */
export const downloadSong = (url: string, title: string | null): void => {
  void invoke<void>('download_song', { url, title });
};

export const onDownloadProgress = async (
  cb: (event: DownloadProgress) => void,
): Promise<UnlistenFn> => {
  return await listen<DownloadProgress>('download-progress', ({ payload }) => cb(payload));
};

export const onDownloadDone = async (cb: (event: DownloadDone) => void): Promise<UnlistenFn> => {
  return await listen<DownloadDone>('download-done', ({ payload }) => cb(payload));
};
