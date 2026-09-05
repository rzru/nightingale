import type { AppConfig } from '@/types/AppConfig';
import type { JellyfinHealth } from '@/types/JellyfinHealth';
import type { JellyfinLoginResult } from '@/types/JellyfinLoginResult';
import type { LibrarySource } from '@/types/LibrarySource';
import type { NavidromeHealth } from '@/types/NavidromeHealth';
import type { NavidromeLoginResult } from '@/types/NavidromeLoginResult';
import type { PlexHealth } from '@/types/PlexHealth';
import type { PlexPinPollResult } from '@/types/PlexPinPollResult';
import type { PlexPinStart } from '@/types/PlexPinStart';
import type { PlexServer } from '@/types/PlexServer';

import { invoke } from './runtime';

export { selectFolderPath } from './folder';

export const triggerScan = async (): Promise<void> => {
  await invoke('trigger_scan');
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
