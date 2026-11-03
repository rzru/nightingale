import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { saveLyrics } from '@/bridge/lyrics';
import { t } from '@/i18n';
import { ANALYSIS_QUEUE, LYRICS, MENU, SONGS, SONGS_META } from '@/shared/query-keys';

export type SaveLyricsInput = {
  hash: string;
  lines: string[];
  title: string;
};

export const useSaveLyricsMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ hash, lines, title }: SaveLyricsInput) => {
      await saveLyrics(hash, lines);
      toast.info(t('lyrics.useSaveLyricsMutation.realigningLyricsFor', { value1: title }));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LYRICS });
      void queryClient.invalidateQueries({ queryKey: MENU });
      void queryClient.invalidateQueries({ queryKey: SONGS });
      void queryClient.invalidateQueries({ queryKey: SONGS_META });
      void queryClient.invalidateQueries({ queryKey: ANALYSIS_QUEUE });
    },
    onError: (error: Error) => {
      toast.error(
        t('lyrics.useSaveLyricsMutation.errorWhileSavingLyrics', { value1: error.message }),
      );
    },
  });
};
