import type { AccountProvider } from '@/types/AccountProvider';
import type { AccountsOverview } from '@/types/AccountsOverview';
import type { AuthPollResult } from '@/types/AuthPollResult';
import type { AuthStart } from '@/types/AuthStart';
import type { WishPlaylist } from '@/types/WishPlaylist';
import type { WishPlaylistDetail } from '@/types/WishPlaylistDetail';
import type { YouTubePlaylist } from '@/types/YouTubePlaylist';

import { invoke } from './runtime';

// ── Linked accounts ─────────────────────────────────────────────────────

export const loadAccountsOverview = async (): Promise<AccountsOverview> => {
  return await invoke<AccountsOverview>('accounts_overview');
};

/**
 * Start the YouTube sign-in. Open `auth_url` in the system browser, then poll
 * `pollAccountAuth` until the status is no longer `pending`.
 */
export const youtubeBeginAuth = async (): Promise<AuthStart> => {
  return await invoke<AuthStart>('youtube_begin_auth');
};

export const pollAccountAuth = async (authId: string): Promise<AuthPollResult> => {
  return await invoke<AuthPollResult>('account_poll_auth', { authId });
};

export const cancelAccountAuth = async (authId: string): Promise<boolean> => {
  return await invoke<boolean>('account_cancel_auth', { authId });
};

export const unlinkAccount = async (provider: AccountProvider): Promise<boolean> => {
  return await invoke<boolean>('account_unlink', { provider });
};

export const youtubeListPlaylists = async (): Promise<YouTubePlaylist[]> => {
  return await invoke<YouTubePlaylist[]>('youtube_list_playlists');
};

// ── Wishes ──────────────────────────────────────────────────────────────

export const importYoutubePlaylist = async (params: {
  playlistId: string;
  name: string;
}): Promise<WishPlaylistDetail> => {
  return await invoke<WishPlaylistDetail>('wishes_import_youtube_playlist', params);
};

export const listWishPlaylists = async (): Promise<WishPlaylist[]> => {
  return await invoke<WishPlaylist[]>('wishes_list_playlists');
};

export const loadWishPlaylist = async (id: string): Promise<WishPlaylistDetail | null> => {
  return await invoke<WishPlaylistDetail | null>('wishes_load_playlist', { id });
};

export const deleteWishPlaylist = async (id: string): Promise<boolean> => {
  return await invoke<boolean>('wishes_delete_playlist', { id });
};

export const refreshWishMatches = async (): Promise<number> => {
  return await invoke<number>('wishes_refresh_matches');
};
