import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { toast } from 'sonner';

import {
  addPlaybackQueueEntry,
  clearPlaybackQueue,
  loadPlaybackQueue,
  movePlaybackQueueEntry,
  onPlaybackQueueChanged,
  removePlaybackQueueEntry,
  type PlaybackQueueEntry,
} from '@/bridge/playback-queue';
import type { PlaybackPlayer, PlaybackTarget } from '@/bridge/playback-session';
import { usePlaybackLauncher } from '@/features/playback/hooks/use-playback-launcher';
import {
  preparePlayback,
  type PreparePlaybackInput,
} from '@/features/playback/mutations/use-prepare-playback-mutation';
import { t } from '@/i18n';
import { PLAYBACK_QUEUE } from '@/shared/query-keys';
import type { Song } from '@/types/Song';

export function usePlaybackQueueQuery() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: PLAYBACK_QUEUE, queryFn: loadPlaybackQueue });

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void onPlaybackQueueChanged((entries) => {
      queryClient.setQueryData(PLAYBACK_QUEUE, entries);
    }).then((stop) => {
      if (cancelled) {
        stop();
        return undefined;
      }
      unlisten = stop;
      void queryClient.invalidateQueries({ queryKey: PLAYBACK_QUEUE });
      return undefined;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [queryClient]);

  return query;
}

type AddPlaybackQueueEntryInput = PreparePlaybackInput & {
  position?: 'top' | 'bottom';
};

export function useAddPlaybackQueueEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ song, tempo, keyOffset, position }: AddPlaybackQueueEntryInput) =>
      addPlaybackQueueEntry(song.file_hash, tempo, keyOffset, position === 'top'),
    onSuccess: (entries) => queryClient.setQueryData(PLAYBACK_QUEUE, entries),
    onError: (error: Error) =>
      toast.error(
        t('playbackQueue.usePlaybackQueue.couldNotAddSongToQueue', { value1: error.message }),
      ),
  });
}

export function useMovePlaybackQueueEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, targetIndex }: { id: string; targetIndex: number }) =>
      movePlaybackQueueEntry(id, targetIndex),
    onMutate: async ({ id, targetIndex }) => {
      await queryClient.cancelQueries({ queryKey: PLAYBACK_QUEUE });
      const previous = queryClient.getQueryData<PlaybackQueueEntry[]>(PLAYBACK_QUEUE);
      if (previous !== undefined) {
        const entries = [...previous];
        const sourceIndex = entries.findIndex((entry) => entry.id === id);
        if (sourceIndex >= 0) {
          const [entry] = entries.splice(sourceIndex, 1);
          entries.splice(targetIndex, 0, entry);
          queryClient.setQueryData(PLAYBACK_QUEUE, entries);
        }
      }
      return { previous };
    },
    onSuccess: (entries) => queryClient.setQueryData(PLAYBACK_QUEUE, entries),
    onError: (error: Error, _input, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(PLAYBACK_QUEUE, context.previous);
      }
      toast.error(
        t('playbackQueue.usePlaybackQueue.couldNotReorderQueue', { value1: error.message }),
      );
    },
  });
}

export function useRemovePlaybackQueueEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: removePlaybackQueueEntry,
    onSuccess: (entries) => queryClient.setQueryData(PLAYBACK_QUEUE, entries),
    onError: (error: Error) =>
      toast.error(
        t('playbackQueue.usePlaybackQueue.couldNotRemoveSongFromQueue', { value1: error.message }),
      ),
  });
}

export function useClearPlaybackQueue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: clearPlaybackQueue,
    onSuccess: (entries) => queryClient.setQueryData(PLAYBACK_QUEUE, entries),
    onError: (error: Error) =>
      toast.error(
        t('playbackQueue.usePlaybackQueue.couldNotClearQueue', { value1: error.message }),
      ),
  });
}

type StartInput = {
  entry: PlaybackQueueEntry;
  target: PlaybackTarget;
  players: PlaybackPlayer[];
};

type StartResult = {
  id: string;
  song: Song;
  entries: PlaybackQueueEntry[];
  target: PlaybackTarget;
  players: PlaybackPlayer[];
};

export function useStartNextPlaybackQueueSong(entries: PlaybackQueueEntry[]) {
  const queryClient = useQueryClient();
  const { launch, reserveTarget } = usePlaybackLauncher();
  const { mutate, isLoading } = useMutation({
    mutationFn: async ({ entry, target, players }: StartInput): Promise<StartResult> => {
      const song = await preparePlayback({
        song: entry.song,
        tempo: entry.tempo,
        keyOffset: entry.keyOffset,
      });
      const nextEntries = await removePlaybackQueueEntry(entry.id);
      return { id: entry.id, song, entries: nextEntries, target, players };
    },
    onSuccess: ({ id, song, entries: nextEntries, target, players }) => {
      queryClient.setQueryData(PLAYBACK_QUEUE, nextEntries);
      void launch(
        {
          song,
          queuePlayback: true,
          playbackId: id,
          players: players.length > 0 ? players : undefined,
        },
        target,
      );
    },
    onError: (error: Error, { target }) => {
      target?.close();
      toast.error(
        t('playbackQueue.usePlaybackQueue.couldNotStartQueuedSong', { value1: error.message }),
      );
    },
  });

  const playNext = useCallback(
    (players: PlaybackPlayer[] = []) => {
      if (entries.length === 0 || isLoading) {
        return;
      }
      const target = reserveTarget();
      if (target === undefined) {
        return;
      }
      mutate({ entry: entries[0], target, players });
    },
    [entries, isLoading, mutate, reserveTarget],
  );

  return { playNext, isPreparing: isLoading };
}
