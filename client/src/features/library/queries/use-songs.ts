import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { getPreloadedSongsMeta, loadAnalysisQueue, loadSongs, loadSongsMeta } from '@/bridge/songs';
import { useLibraryFilter } from '@/features/menu/hooks/use-library-filter';
import { useSearch } from '@/features/menu/hooks/use-search';
import { useConfig } from '@/shared/config/use-config';
import { ANALYSIS_QUEUE, SONGS, SONGS_META, MENU } from '@/shared/query-keys';
import type { AnalysisQueue } from '@/types/AnalysisQueue';
import type { LoadSongsParams } from '@/types/LoadSongsParams';
import type { SongsMeta } from '@/types/SongsMeta';

const PAGE_SIZE = 25;
const DEFAULT_REFETCH_INTERVAL = 2500;

export const useSongsMeta = () => {
  const queryClient = useQueryClient();
  const [prevMatched, setPrevMatched] = useState(true);
  const preloaded = getPreloadedSongsMeta();

  return useQuery({
    queryKey: SONGS_META,
    queryFn: loadSongsMeta,
    refetchInterval: DEFAULT_REFETCH_INTERVAL,
    ...(preloaded !== undefined ? { initialData: preloaded } : {}),
    onSuccess: ({ count, processed_count }: SongsMeta) => {
      if (count !== processed_count) {
        setPrevMatched(false);
        void queryClient.invalidateQueries({ queryKey: SONGS });
        void queryClient.invalidateQueries({ queryKey: MENU });
      } else {
        if (!prevMatched) {
          setPrevMatched(true);
          void queryClient.invalidateQueries({ queryKey: SONGS });
          void queryClient.invalidateQueries({ queryKey: MENU });
        }
      }
    },
  });
};

export const useSongs = () => {
  const { data: config } = useConfig();
  const { search } = useSearch();
  const { artist, album, playlist, folder, query, status, transcript_source } = useLibraryFilter();
  const sort = config?.song_list_sort ?? [];

  return useInfiniteQuery({
    queryKey: [
      ...SONGS,
      search,
      artist,
      album,
      playlist,
      folder,
      query,
      status,
      transcript_source,
      sort,
    ],
    queryFn: ({ pageParam = 0 }: { pageParam?: number }) => {
      const params: LoadSongsParams = {
        search: search || null,
        filters: {
          artist: artist ?? null,
          album: album ?? null,
          playlist: playlist ?? null,
          folder,
          query: query ?? null,
          status: status ?? null,
          transcript_source: transcript_source ?? null,
          search: null,
        },
        sort: sort.length === 0 ? null : sort,
        skip: pageParam,
        take: PAGE_SIZE,
      };
      return loadSongs(params);
    },
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.processed.length, 0);
      return loaded < lastPage.processed_count ? loaded : undefined;
    },
  });
};

export const useAnalysisQueue = () => {
  const queryClient = useQueryClient();
  const prevEntriesRef = useRef<string | null>(null);

  return useQuery({
    queryKey: ANALYSIS_QUEUE,
    queryFn: loadAnalysisQueue,
    refetchInterval: 2500,
    onSuccess: (data: AnalysisQueue) => {
      const entries = Object.entries(data.entries)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([hash, status]) => `${hash}:${JSON.stringify(status)}`)
        .join('|');
      const previous = prevEntriesRef.current;

      if (previous !== null && previous !== entries) {
        void queryClient.invalidateQueries({ queryKey: SONGS });
        void queryClient.invalidateQueries({ queryKey: MENU });
        void queryClient.invalidateQueries({ queryKey: SONGS_META });
      }

      prevEntriesRef.current = entries;
    },
  });
};
