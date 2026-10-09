import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { alignLrcLyrics, applyTimedLyrics, provideLrc } from '@/bridge/lyrics';
import { ANALYSIS_QUEUE, LYRICS, MENU, SONGS, SONGS_META } from '@/shared/query-keys';

const LYRICS_QUERY_KEYS = [LYRICS, MENU, SONGS, SONGS_META, ANALYSIS_QUEUE];

const invalidateLyricsQueries = (queryClient: ReturnType<typeof useQueryClient>) => {
  for (const key of LYRICS_QUERY_KEYS) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
};

export type ProvideLrcInput = {
  hash: string;
  lrcText: string;
  separateStems: boolean;
  title: string;
};

export const useProvideLrcMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ hash, lrcText, separateStems, title }: ProvideLrcInput) => {
      await provideLrc(hash, lrcText, separateStems);
      toast.info(
        separateStems ? `Separating stems for "${title}"` : `Saved timed lyrics for "${title}"`,
      );
    },
    onSuccess: () => invalidateLyricsQueries(queryClient),
    onError: (error: Error) => {
      toast.error(`Error while providing lyrics: ${error.message}`);
    },
  });
};

export type ApplyTimedLyricsInput = {
  hash: string;
  lrcText: string;
  title: string;
};

export const useApplyTimedLyricsMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ hash, lrcText, title }: ApplyTimedLyricsInput) => {
      await applyTimedLyrics(hash, lrcText);
      toast.info(`Applied timed lyrics to "${title}"`);
    },
    onSuccess: () => invalidateLyricsQueries(queryClient),
    onError: (error: Error) => {
      toast.error(`Error while applying timed lyrics: ${error.message}`);
    },
  });
};

export const useAlignLrcMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ hash, lrcText, title }: ApplyTimedLyricsInput) => {
      await alignLrcLyrics(hash, lrcText);
      toast.info(`Aligning words within the line timing of "${title}"`);
    },
    onSuccess: () => invalidateLyricsQueries(queryClient),
    onError: (error: Error) => {
      toast.error(`Error while aligning timed lyrics: ${error.message}`);
    },
  });
};
