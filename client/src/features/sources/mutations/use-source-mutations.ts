import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSetAtom } from 'jotai';
import { toast } from 'sonner';

import {
  clearLibrarySource,
  jellyfinLogin,
  navidromeLogin,
  reconcileCache,
  selectFolderPath,
  setLibrarySource,
  triggerScan,
} from '@/bridge/source';
import { EMPTY_LIBRARY_FILTER } from '@/features/library/lib/library-menu-filter';
import { libraryFilterAtom } from '@/features/menu/hooks/use-library-filter';
import { searchAtom } from '@/features/menu/hooks/use-search';
import {
  ANALYSIS_QUEUE,
  CONFIG,
  JELLYFIN_HEALTH,
  MENU,
  NAVIDROME_HEALTH,
  PLEX_HEALTH,
  SONGS,
  SONGS_META,
} from '@/shared/query-keys';
import type { AppConfig } from '@/types/AppConfig';
import type { CacheReconcileSummary } from '@/types/CacheReconcileSummary';
import type { JellyfinHealth } from '@/types/JellyfinHealth';
import type { JellyfinLoginResult } from '@/types/JellyfinLoginResult';
import type { NavidromeHealth } from '@/types/NavidromeHealth';
import type { NavidromeLoginResult } from '@/types/NavidromeLoginResult';
import type { PlexHealth } from '@/types/PlexHealth';
import type { PlexServer } from '@/types/PlexServer';

const useInvalidateLibrary = () => {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: CONFIG });
    void queryClient.invalidateQueries({ queryKey: SONGS });
    void queryClient.invalidateQueries({ queryKey: SONGS_META });
    void queryClient.invalidateQueries({ queryKey: MENU });
    void queryClient.invalidateQueries({ queryKey: ANALYSIS_QUEUE });
    void queryClient.invalidateQueries({ queryKey: JELLYFIN_HEALTH });
    void queryClient.invalidateQueries({ queryKey: NAVIDROME_HEALTH });
    void queryClient.invalidateQueries({ queryKey: PLEX_HEALTH });
  };
};

/** Drop any library filter / search left over from the previous source so the
 * new library renders as "all songs" instead of accidentally filtering by an
 * artist that no longer exists. */
const useResetLibraryNavigation = () => {
  const setLibraryFilter = useSetAtom(libraryFilterAtom);
  const setSearch = useSetAtom(searchAtom);

  return () => {
    setLibraryFilter(EMPTY_LIBRARY_FILTER);
    setSearch('');
  };
};

/** Pick a folder, persist it as the active source, and kick off a scan. */
export const useSelectFolderSource = () => {
  const queryClient = useQueryClient();
  const invalidateLibrary = useInvalidateLibrary();
  const resetNavigation = useResetLibraryNavigation();

  return useMutation({
    mutationFn: async (): Promise<AppConfig | null> => {
      const path = await selectFolderPath();
      if (typeof path !== 'string' || path === '') {
        return null;
      }
      return setLibrarySource({ kind: 'folder', path });
    },
    onSuccess: (config) => {
      if (!config) {
        return;
      }
      queryClient.setQueryData(CONFIG, config);
      resetNavigation();
      invalidateLibrary();
    },
    onError: (error: Error) => {
      toast.error(`Failed to select folder: ${error.message}`);
    },
  });
};

const songs = (count: number) => `${count} song${count === 1 ? '' : 's'}`;

const notifyReconcile = ({ updated, skipped }: CacheReconcileSummary) => {
  if (updated > 0) {
    const detail = skipped > 0 ? `; ${songs(skipped)} still incomplete` : '';
    toast.success(`Marked ${songs(updated)} ready from the cache${detail}`);
  } else if (skipped > 0) {
    toast.warning(`${songs(skipped)} in the cache still incomplete; nothing marked ready`);
  }
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'unknown error';

/**
 * Re-run the scan against the currently configured source, then pick up any
 * analyses another machine left in a shared cache folder. The scan runs in the
 * background as before; the cache pass is best-effort, so its failure reports
 * separately instead of failing the rescan.
 */
export const useRescan = () => {
  const invalidateLibrary = useInvalidateLibrary();

  return useMutation({
    mutationFn: async (): Promise<CacheReconcileSummary | null> => {
      await triggerScan();
      try {
        return await reconcileCache();
      } catch (error: unknown) {
        toast.warning(`Rescan started, but the cache could not be checked: ${errorMessage(error)}`);
        return null;
      }
    },
    onSuccess: (summary) => {
      invalidateLibrary();
      if (summary) {
        notifyReconcile(summary);
      }
    },
    onError: (error: Error) => {
      toast.error(`Rescan failed: ${error.message}`);
    },
  });
};

/** Disconnect from whatever source is currently configured. */
export const useDisconnectSource = () => {
  const queryClient = useQueryClient();
  const invalidateLibrary = useInvalidateLibrary();
  const resetNavigation = useResetLibraryNavigation();

  return useMutation({
    mutationFn: clearLibrarySource,
    onSuccess: (config) => {
      queryClient.setQueryData(CONFIG, config);
      resetNavigation();
      invalidateLibrary();
    },
    onError: (error: Error) => {
      toast.error(`Could not clear source: ${error.message}`);
    },
  });
};

/**
 * Authenticate against a Jellyfin server. Does NOT persist the source — the
 * caller can chain this into `useConnectJellyfin` for that, or use it for a
 * standalone "Test connection" flow.
 */
export const useJellyfinLogin = () =>
  useMutation<JellyfinLoginResult, Error, { baseUrl: string; username: string; password: string }>({
    mutationFn: jellyfinLogin,
  });

/**
 * Composite: authenticate, persist the credentials as the active library
 * source, and trigger a scan (which is already done backend-side by
 * `set_library_source`).
 */
export const useConnectJellyfin = () => {
  const queryClient = useQueryClient();
  const invalidateLibrary = useInvalidateLibrary();
  const resetNavigation = useResetLibraryNavigation();

  return useMutation<
    { config: AppConfig; login: JellyfinLoginResult },
    Error,
    { baseUrl: string; username: string; password: string; selectedIds: string[] }
  >({
    mutationFn: async ({ selectedIds, ...params }) => {
      const login = await jellyfinLogin(params);
      const config = await setLibrarySource({
        kind: 'jellyfin',
        base_url: login.server_url,
        user_id: login.user_id,
        username: login.username,
        access_token: login.access_token,
        device_id: login.device_id,
        library_ids: selectedIds,
      });
      return { config, login };
    },
    onSuccess: ({ config, login }) => {
      queryClient.setQueryData(CONFIG, config);

      // Seed the health cache from the successful login so the sidebar pill
      // flips to green immediately instead of waiting for the next poll.
      queryClient.setQueryData<JellyfinHealth>(JELLYFIN_HEALTH, {
        reachable: true,
        server_name: login.server_name ?? undefined,
        server_id: undefined,
        version: undefined,
        error: undefined,
      });

      resetNavigation();
      invalidateLibrary();
    },
  });
};

/**
 * Authenticate against a Navidrome / Subsonic server. Mirrors
 * `useJellyfinLogin`: no persistence, just a smoke test the dialog can use
 * to display a friendly error before it asks to commit the source.
 */
export const useNavidromeLogin = () =>
  useMutation<NavidromeLoginResult, Error, { baseUrl: string; username: string; password: string }>(
    {
      mutationFn: navidromeLogin,
    },
  );

/**
 * Composite: authenticate, persist the credentials as the active library
 * source, and trigger a scan (which is done backend-side as part of
 * `set_library_source`).
 */
export const useConnectNavidrome = () => {
  const queryClient = useQueryClient();
  const invalidateLibrary = useInvalidateLibrary();
  const resetNavigation = useResetLibraryNavigation();

  return useMutation<
    { config: AppConfig; login: NavidromeLoginResult },
    Error,
    { baseUrl: string; username: string; password: string; selectedIds: string[] }
  >({
    mutationFn: async ({ selectedIds: _selectedIds, ...params }) => {
      const login = await navidromeLogin(params);
      const config = await setLibrarySource({
        kind: 'navidrome',
        base_url: login.server_url,
        username: login.username,
        password: login.password,
      });
      return { config, login };
    },
    onSuccess: ({ config, login }) => {
      queryClient.setQueryData(CONFIG, config);

      queryClient.setQueryData<NavidromeHealth>(NAVIDROME_HEALTH, {
        reachable: true,
        server_name: login.server_name ?? undefined,
        version: login.server_version ?? undefined,
        error: undefined,
      });

      resetNavigation();
      invalidateLibrary();
    },
  });
};

/** Persist a discovered/verified Plex server and the user's selected music sections. */
export const useConnectPlex = () => {
  const queryClient = useQueryClient();
  const invalidateLibrary = useInvalidateLibrary();
  const resetNavigation = useResetLibraryNavigation();

  return useMutation<
    { config: AppConfig; server: PlexServer },
    Error,
    { server: PlexServer; sectionIds: string[] }
  >({
    mutationFn: async ({ server, sectionIds }) => {
      if (sectionIds.length === 0) {
        throw new Error('Select at least one music library');
      }
      const config = await setLibrarySource({
        kind: 'plex',
        base_url: server.server_url,
        server_name: server.server_name,
        machine_id: server.server_id,
        username: server.username,
        access_token: server.access_token,
        client_id: server.client_id,
        section_ids: sectionIds,
      });
      return { config, server };
    },
    onSuccess: ({ config, server }) => {
      queryClient.setQueryData(CONFIG, config);
      queryClient.setQueryData<PlexHealth>(PLEX_HEALTH, {
        reachable: true,
        server_name: server.server_name,
        version: undefined,
        server_id: server.server_id,
        error: undefined,
      });
      resetNavigation();
      invalidateLibrary();
    },
  });
};
