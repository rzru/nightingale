import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  cancelWishDownloads,
  deleteWishPlaylist,
  importYoutubePlaylist,
  prepareWishPlaylist,
  prepareWishes,
  unlinkAccount,
} from '@/bridge/accounts';
import { t, tp } from '@/i18n';
import {
  ACCOUNTS,
  WISH_DOWNLOADER,
  WISH_PLAYLIST,
  WISH_PLAYLISTS,
  YOUTUBE_PLAYLISTS,
} from '@/shared/query-keys';
import type { PrepareSummary } from '@/types/PrepareSummary';

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const useInvalidateWishes = () => {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: WISH_PLAYLISTS });
    await queryClient.invalidateQueries({ queryKey: WISH_PLAYLIST });
    await queryClient.invalidateQueries({ queryKey: WISH_DOWNLOADER });
  };
};

const reportPrepared = (summary: PrepareSummary): void => {
  if (summary.downloads === 0 && summary.analyses === 0) {
    toast.info(t('playlists.prepare.nothingToDo'));
    return;
  }
  toast.success(
    t('playlists.prepare.started', {
      downloads: summary.downloads,
      analyses: summary.analyses,
    }),
  );
};

export const useUnlinkYoutube = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => await unlinkAccount('youtube'),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: YOUTUBE_PLAYLISTS });
      await queryClient.invalidateQueries({ queryKey: ACCOUNTS });
    },
    onError: (error) => {
      toast.error(t('playlists.account.unlinkFailed', { value1: errorMessage(error) }));
    },
  });
};

export const useImportPlaylist = (onImported: (id: string) => void) => {
  const invalidate = useInvalidateWishes();
  return useMutation({
    mutationFn: importYoutubePlaylist,
    onSuccess: async (detail) => {
      toast.success(
        tp('playlists.import.done', detail.playlist.counts.total, {
          name: detail.playlist.name,
        }),
      );
      await invalidate();
      onImported(detail.playlist.id);
    },
    onError: (error) => {
      toast.error(t('playlists.import.failed', { value1: errorMessage(error) }));
    },
  });
};

export const usePreparePlaylist = () => {
  const invalidate = useInvalidateWishes();
  return useMutation({
    mutationFn: prepareWishPlaylist,
    onSuccess: async (summary) => {
      reportPrepared(summary);
      await invalidate();
    },
    onError: (error) => {
      toast.error(t('playlists.prepare.failed', { value1: errorMessage(error) }));
    },
  });
};

export const usePrepareWish = () => {
  const invalidate = useInvalidateWishes();
  return useMutation({
    mutationFn: async (id: number) => await prepareWishes([id]),
    onSuccess: async (summary) => {
      reportPrepared(summary);
      await invalidate();
    },
    onError: (error) => {
      toast.error(t('playlists.prepare.failed', { value1: errorMessage(error) }));
    },
  });
};

export const useCancelDownloads = () => {
  const invalidate = useInvalidateWishes();
  return useMutation({
    mutationFn: cancelWishDownloads,
    onSettled: invalidate,
  });
};

export const useDeleteWishPlaylist = (onDeleted: () => void) => {
  const invalidate = useInvalidateWishes();
  return useMutation({
    mutationFn: deleteWishPlaylist,
    onSuccess: async () => {
      await invalidate();
      onDeleted();
    },
    onError: (error) => {
      toast.error(t('playlists.detail.deleteFailed', { value1: errorMessage(error) }));
    },
  });
};
