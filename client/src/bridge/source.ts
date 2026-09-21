import { open } from '@tauri-apps/plugin-dialog';
import { z } from 'zod';

import type { AppConfig } from '@/types/AppConfig';
import type { CacheReconcileSummary } from '@/types/CacheReconcileSummary';
import type { JellyfinHealth } from '@/types/JellyfinHealth';
import type { JellyfinLoginResult } from '@/types/JellyfinLoginResult';
import type { LibrarySource } from '@/types/LibrarySource';
import type { NavidromeHealth } from '@/types/NavidromeHealth';
import type { NavidromeLoginResult } from '@/types/NavidromeLoginResult';
import type { PlexHealth } from '@/types/PlexHealth';
import type { PlexPinPollResult } from '@/types/PlexPinPollResult';
import type { PlexPinStart } from '@/types/PlexPinStart';
import type { PlexServer } from '@/types/PlexServer';

import { invoke, isTauri } from './runtime';

/**
 * Prompt the user for a local folder path. Returns `undefined` when the user
 * dismisses the picker.
 */
export const selectFolderPath = async (): Promise<string | undefined> => {
  if (!isTauri) {
    // Browsers don't expose absolute filesystem paths via file pickers, so the
    // server-hosted build asks the user to type a path the server can see.
    const input = window.prompt('Songs folder path (visible to the server)', '/songs');

    if (typeof input !== 'string' || input === '') {
      return undefined;
    }

    const trimmed = input.trim();

    return trimmed.length > 0 ? trimmed : undefined;
  }

  const folder = await open({ directory: true, multiple: false });

  return folder ?? undefined;
};

export const triggerScan = async (): Promise<void> => {
  await invoke('trigger_scan');
};

const cacheReconcileSummarySchema = z.object({
  matched: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
}) satisfies z.ZodType<CacheReconcileSummary>;

/** Mark library songs analyzed when the (possibly shared) cache already holds their analysis. */
export const reconcileCache = async (): Promise<CacheReconcileSummary> => {
  const value = await invoke('reconcile_cache');
  return cacheReconcileSummarySchema.parse(value);
};

export const setLibrarySource = async (source: LibrarySource): Promise<AppConfig> => {
  return await invoke<AppConfig>('set_library_source', { source });
};

export const clearLibrarySource = async (): Promise<AppConfig> => {
  return await invoke<AppConfig>('clear_library_source');
};

export const jellyfinLogin = async (params: {
  baseUrl: string;
  username: string;
  password: string;
}): Promise<JellyfinLoginResult> => {
  return await invoke<JellyfinLoginResult>('jellyfin_login', params);
};

export const jellyfinPing = async (): Promise<JellyfinHealth> => {
  return await invoke<JellyfinHealth>('jellyfin_ping');
};

export const navidromeLogin = async (params: {
  baseUrl: string;
  username: string;
  password: string;
}): Promise<NavidromeLoginResult> => {
  return await invoke<NavidromeLoginResult>('navidrome_login', params);
};

export const navidromePing = async (): Promise<NavidromeHealth> => {
  return await invoke<NavidromeHealth>('navidrome_ping');
};

export const plexBeginPin = async (clientId?: string): Promise<PlexPinStart> => {
  return await invoke<PlexPinStart>('plex_begin_pin', { clientId });
};

export const plexPollPin = async (params: {
  pinId: string;
  clientId: string;
}): Promise<PlexPinPollResult> => {
  return await invoke<PlexPinPollResult>('plex_poll_pin', params);
};

export const plexManualLogin = async (params: {
  baseUrl: string;
  accessToken: string;
  clientId?: string;
}): Promise<PlexServer> => {
  return await invoke<PlexServer>('plex_manual_login', params);
};

export const plexPing = async (): Promise<PlexHealth> => {
  return await invoke<PlexHealth>('plex_ping');
};
