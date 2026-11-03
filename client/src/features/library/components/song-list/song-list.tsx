import { useCallback, useMemo, useState, type RefObject } from 'react';

import type { PlaybackPlayer } from '@/bridge/playback-session';
import { useAnalysis } from '@/features/library/hooks/use-analysis';
import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useAddPlaybackQueueEntry } from '@/features/playback-queue/use-playback-queue';
import { MultiplayerSetupDialog } from '@/features/playback/components/dialogs/multiplayer-setup';
import { usePlaybackLauncher } from '@/features/playback/hooks/use-playback-launcher';
import { t } from '@/i18n';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/components/ui/empty';
import type { Song } from '@/types/Song';
import type { SongSort } from '@/types/SongSort';
import type { SongSortColumn } from '@/types/SongSortColumn';

import type { SongListView } from '../library-toolbar';
import type { SongItemProps, SongListActions } from './types';
import { SongGrid } from './views/song-grid';
import { SongTable } from './views/song-table';

type SongListProps = {
  songs: Song[];
  view: SongListView;
  sort: readonly SongSort[];
  sortingDisabled: boolean;
  loading: boolean;
  filtered: boolean;
  getItemProps: (song: Song, index: number) => SongItemProps;
  setScrollContainer: (element: HTMLElement | null) => void;
  sentinelRef: RefObject<HTMLDivElement | null>;
  onSort: (column: SongSortColumn) => void;
};

export const SongList = ({
  songs,
  view,
  sort,
  sortingDisabled,
  loading,
  filtered,
  getItemProps,
  setScrollContainer,
  sentinelRef,
  onSort,
}: SongListProps) => {
  const { mutate: addToQueue, isLoading: addingToQueue } = useAddPlaybackQueueEntry();
  const { enqueueOne } = useAnalysis();
  const { setMode } = useDialog();
  const { launch, reserveTarget } = usePlaybackLauncher();
  const [multiplayerSong, setMultiplayerSong] = useState<Song | null>(null);

  const play = useCallback(
    (song: Song, players?: PlaybackPlayer[]) => {
      const target = reserveTarget();
      if (target !== undefined) {
        void launch({ song, queuePlayback: false, players }, target);
      }
    },
    [launch, reserveTarget],
  );
  const actions = useMemo<SongListActions>(
    () => ({
      addingToQueue,
      onAddToQueue: (song, position) =>
        addToQueue({ song, tempo: song.tempo, keyOffset: song.key_offset, position }),
      onAnalyze: (song) => void enqueueOne(song.file_hash),
      onPlay: play,
      onPlayMultiplayer: setMultiplayerSong,
      onProvideLyrics: (song) => setMode({ mode: 'edit-lyrics', song }),
    }),
    [addToQueue, addingToQueue, enqueueOne, play, setMode],
  );

  if (songs.length === 0 && !loading) {
    return (
      <Empty className="px-4">
        <EmptyHeader>
          <EmptyTitle>
            {t(filtered ? 'library.songList.noResults' : 'library.songList.noSongs')}
          </EmptyTitle>
          <EmptyDescription>
            {t(
              filtered
                ? 'library.songList.noResultsDescription'
                : 'library.songList.noSongsDescription',
            )}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <div
        ref={setScrollContainer}
        data-song-layout={view}
        className="themed-scrollbar song-table-shell min-h-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        {view === 'table' ? (
          <SongTable
            songs={songs}
            sort={sort}
            sortingDisabled={sortingDisabled}
            onSort={onSort}
            getItemProps={getItemProps}
            actions={actions}
          />
        ) : (
          <SongGrid songs={songs} getItemProps={getItemProps} actions={actions} />
        )}
        <div ref={sentinelRef} className="h-1" aria-hidden="true" />
      </div>

      <MultiplayerSetupDialog
        open={multiplayerSong !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMultiplayerSong(null);
          }
        }}
        onStart={(players) => {
          if (multiplayerSong !== null) {
            play(multiplayerSong, players);
          }
        }}
      />
    </>
  );
};
