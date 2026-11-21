import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  loadAccountsOverview,
  listWishPlaylists,
  loadWishDownloaderStatus,
  loadWishPlaylist,
  youtubeListPlaylists,
} from '@/bridge/accounts';
import { listen } from '@/bridge/runtime';
import {
  ACCOUNTS,
  WISH_DOWNLOADER,
  WISH_PLAYLIST,
  WISH_PLAYLISTS,
  YOUTUBE_PLAYLISTS,
} from '@/shared/query-keys';
import type { WishPlaylistDetail } from '@/types/WishPlaylistDetail';

const ACTIVE_REFRESH_MS = 1_500;
const IDLE_REFRESH_MS = 10_000;

/** Keep the playlist screens in sync with backend events. */
export const usePlaylistEvents = (): void => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unlisteners = [
      listen('accounts-changed', () => {
        void queryClient.invalidateQueries({ queryKey: ACCOUNTS });
        void queryClient.invalidateQueries({ queryKey: YOUTUBE_PLAYLISTS });
      }),
      listen('wishes-changed', () => {
        void queryClient.invalidateQueries({ queryKey: WISH_PLAYLISTS });
        void queryClient.invalidateQueries({ queryKey: WISH_PLAYLIST });
        void queryClient.invalidateQueries({ queryKey: WISH_DOWNLOADER });
      }),
    ];

    return () => {
      for (const pending of unlisteners) {
        void pending.then((unlisten) => unlisten()).catch(() => undefined);
      }
    };
  }, [queryClient]);
};

export const useAccounts = () =>
  useQuery({
    queryKey: ACCOUNTS,
    queryFn: loadAccountsOverview,
  });

export const useYoutubePlaylists = (enabled: boolean) =>
  useQuery({
    queryKey: YOUTUBE_PLAYLISTS,
    queryFn: youtubeListPlaylists,
    enabled,
    staleTime: 60_000,
    retry: false,
  });

export const useDownloaderStatus = () =>
  useQuery({
    queryKey: WISH_DOWNLOADER,
    queryFn: loadWishDownloaderStatus,
    refetchInterval: (data) => (data?.running === true ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS),
  });

export const useWishPlaylists = () =>
  useQuery({
    queryKey: WISH_PLAYLISTS,
    queryFn: listWishPlaylists,
    refetchInterval: IDLE_REFRESH_MS,
  });

const hasWorkInProgress = (detail: WishPlaylistDetail | null | undefined): boolean =>
  detail?.wishes.some((wish) => wish.status === 'downloading' || wish.status === 'analyzing') ??
  false;

/** One imported playlist; polls fast while downloads or analyses run. */
export const useWishPlaylist = (id: string | null) =>
  useQuery({
    queryKey: [...WISH_PLAYLIST, id],
    queryFn: async () => (id === null ? null : await loadWishPlaylist(id)),
    enabled: id !== null,
    refetchInterval: (data) => (hasWorkInProgress(data) ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS),
  });
