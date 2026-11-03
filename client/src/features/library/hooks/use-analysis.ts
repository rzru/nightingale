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
import { t, tp } from '@/i18n';
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
          t('library.useAnalysis.errorWhileRunningAnAnalysisAction', {
            value1: error instanceof Error ? error.message : 'unknown error',
          }),
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
          const action = t(label);
          toast.success(
            kind === BulkActionKind.Queued
              ? tp('library.analysis.queuedOne', 'library.analysis.queuedOther', count, { action })
              : tp('library.analysis.completedOne', 'library.analysis.completedOther', count, {
                  action,
                }),
          );
        } else {
          toast.info(t('library.analysis.noneEligible', { action: t(label) }));
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
        'library.analysis.actions.cancelled',
        () => cancelAnalysis(filtered()),
        invalidateSongs,
      ),
      deleteSongCache: wrap(async (fileHash: string) => {
        await deleteSongCache(one(fileHash));
        markSongCacheDeleted(fileHash);
      }, invalidateSongs),
      deleteSongCacheAll: wrapBulk(
        BulkActionKind.Immediate,
        'library.analysis.actions.cacheDeleted',
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
        'library.analysis.actions.realigning',
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
        'library.analysis.actions.metadataRefreshed',
        () => refreshMetadata(filtered()),
        invalidateSongs,
      ),
      reanalyzeAllFull: wrapBulk(
        BulkActionKind.Queued,
        'library.analysis.actions.fullReanalysis',
        () => reanalyzeFull(filtered()),
        invalidateSongs,
      ),
      reanalyzeAllTranscript: wrapBulk(
        BulkActionKind.Queued,
        'library.analysis.actions.refetchingLyrics',
        (language?: string) => reanalyzeTranscript(filtered(), language),
        invalidateSongs,
      ),
      reanalyzeAllForceTranscribe: wrapBulk(
        BulkActionKind.Queued,
        'library.analysis.actions.forceTranscribing',
        () => reanalyzeForceTranscribe(filtered()),
        invalidateSongs,
      ),
    };
  }, [queryClient, artist, album, playlist, folder, query, status, transcript_source, search]);
};
