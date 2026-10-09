import { type InfiniteData, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { toast } from 'sonner';

import {
  cancelAnalysis,
  deleteSongCache,
  enqueue,
  realign,
  reanalyzeForceTranscribe,
  reanalyzeFull,
  reanalyzeTranscript,
  refreshMetadata,
  songsByFilter,
  songsByHashes,
} from '@/bridge/analysis';
import { useLibraryFilter } from '@/features/menu/hooks/use-library-filter';
import { useSearch } from '@/features/menu/hooks/use-search';
import { ANALYSIS_QUEUE, MENU, SONGS, SONGS_META } from '@/shared/query-keys';
import type { LibraryMenuFilters } from '@/types/LibraryMenuFilters';
import type { Song } from '@/types/Song';
import type { SongsStore } from '@/types/SongsStore';

enum BulkActionKind {
  Queued,
  Immediate,
}

const withoutAnalysisCache = (song: Song): Song => ({
  ...song,
  is_analyzed: false,
  language: null,
  transcript_source: null,
  key: null,
  override_key: null,
  tempo: 1,
  key_offset: 0,
  no_stems: false,
});

export const useAnalysis = () => {
  const queryClient = useQueryClient();
  const { artist, album, playlist, folder, query, status, transcript_source } = useLibraryFilter();
  const { search } = useSearch();

  return useMemo(() => {
    const currentFilters = (): LibraryMenuFilters => ({
      artist,
      album,
      playlist,
      folder,
      query,
      status,
      transcript_source,
      search: search || null,
    });

    const invalidateQueue = () => {
      void queryClient.invalidateQueries({ queryKey: ANALYSIS_QUEUE });
    };

    const invalidateSongs = () => {
      void queryClient.invalidateQueries({ queryKey: MENU });
      void queryClient.invalidateQueries({ queryKey: SONGS });
      void queryClient.invalidateQueries({ queryKey: SONGS_META });
      void queryClient.invalidateQueries({ queryKey: ANALYSIS_QUEUE });
    };

    const markSongCacheDeleted = (fileHash: string) => {
      queryClient.setQueriesData<InfiniteData<SongsStore>>(
        { queryKey: SONGS },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              processed: page.processed.map((song) =>
                song.file_hash === fileHash ? withoutAnalysisCache(song) : song,
              ),
            })),
          },
      );
    };

    const run = async <R>(handler: () => Promise<R>, invalidate: () => void) => {
      try {
        return await handler();
      } catch (error: unknown) {
        toast.error(
          `Error while running an analysis action: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
        return undefined;
      } finally {
        invalidate();
      }
    };

    const wrap =
      <A extends unknown[], R>(handler: (...args: A) => Promise<R>, invalidate: () => void) =>
      async (...args: A) => {
        await run(() => handler(...args), invalidate);
      };

    const wrapBulk =
      <A extends unknown[]>(
        kind: BulkActionKind,
        label: string,
        handler: (...args: A) => Promise<number>,
        invalidate: () => void,
      ) =>
      async (...args: A) => {
        const count = await run(() => handler(...args), invalidate);
        if (count === undefined) {
          return;
        }

        if (count > 0) {
          toast.success(
            kind === BulkActionKind.Queued
              ? `Queued ${count} song${count === 1 ? '' : 's'} for ${label}`
              : `${label} for ${count} song${count === 1 ? '' : 's'}`,
          );
        } else {
          toast.info(
            `No eligible songs for ${kind === BulkActionKind.Queued ? label : label.toLowerCase()} in the current filter`,
          );
        }
      };

    const one = (fileHash: string) => songsByHashes([fileHash]);
    const filtered = () => songsByFilter(currentFilters());

    return {
      enqueueOne: wrap((fileHash: string) => enqueue(one(fileHash)), invalidateQueue),
      enqueueAll: wrap(() => enqueue(filtered()), invalidateQueue),
      cancelAnalysisOne: wrap((fileHash: string) => cancelAnalysis(one(fileHash)), invalidateSongs),
      cancelAnalysisAll: wrapBulk(
        BulkActionKind.Immediate,
        'Analysis cancelled',
        () => cancelAnalysis(filtered()),
        invalidateSongs,
      ),
      deleteSongCache: wrap(async (fileHash: string) => {
        await deleteSongCache(one(fileHash));
        markSongCacheDeleted(fileHash);
      }, invalidateSongs),
      deleteSongCacheAll: wrapBulk(
        BulkActionKind.Immediate,
        'Cache deleted',
        () => deleteSongCache(filtered()),
        invalidateSongs,
      ),
      reanalyzeTranscript: wrap(
        (fileHash: string, language?: string) => reanalyzeTranscript(one(fileHash), language),
        invalidateSongs,
      ),
      reanalyzeFull: wrap((fileHash: string) => reanalyzeFull(one(fileHash)), invalidateSongs),
      realign: wrap(
        (fileHash: string, language?: string) => realign(one(fileHash), language),
        invalidateSongs,
      ),
      realignAll: wrapBulk(
        BulkActionKind.Queued,
        'realigning',
        () => realign(filtered()),
        invalidateSongs,
      ),
      reanalyzeForceTranscribe: wrap(
        (fileHash: string) => reanalyzeForceTranscribe(one(fileHash)),
        invalidateSongs,
      ),
      refreshMetadata: (fileHash: string) =>
        run(async () => (await refreshMetadata(one(fileHash))) > 0, invalidateSongs),
      refreshMetadataAll: wrapBulk(
        BulkActionKind.Immediate,
        'Metadata refreshed',
        () => refreshMetadata(filtered()),
        invalidateSongs,
      ),
      reanalyzeAllFull: wrapBulk(
        BulkActionKind.Queued,
        'full reanalysis',
        () => reanalyzeFull(filtered()),
        invalidateSongs,
      ),
      reanalyzeAllTranscript: wrapBulk(
        BulkActionKind.Queued,
        'refetching lyrics & aligning',
        (language?: string) => reanalyzeTranscript(filtered(), language),
        invalidateSongs,
      ),
      reanalyzeAllForceTranscribe: wrapBulk(
        BulkActionKind.Queued,
        'force transcribing',
        () => reanalyzeForceTranscribe(filtered()),
        invalidateSongs,
      ),
    };
  }, [queryClient, artist, album, playlist, folder, query, status, transcript_source, search]);
};
