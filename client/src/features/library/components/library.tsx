import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PlaybackQueueEntry } from '@/bridge/playback-queue';
import { useAnalysisQueue, useSongs } from '@/features/library/queries/use-songs';
import { useLibraryFilter } from '@/features/menu/hooks/use-library-filter';
import { useSearch } from '@/features/menu/hooks/use-search';
import { useMenuFocus } from '@/features/menu/providers/menu-focus-context';
import { QueueSidebar } from '@/features/playback-queue/components/queue-sidebar';
import { usePlaybackQueueQuery } from '@/features/playback-queue/use-playback-queue';
import { Separator } from '@/shared/components/ui/separator';
import { useConfig } from '@/shared/config/use-config';
import { useConfigMutation } from '@/shared/config/use-config-mutation';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';
import { usePersistentScroll } from '@/shared/hooks/use-persistent-scroll';
import { cn } from '@/shared/utils/cn';
import type { AppConfig } from '@/types/AppConfig';
import type { QueuedStatus } from '@/types/QueuedStatus';
import type { Song } from '@/types/Song';
import type { SongSort } from '@/types/SongSort';
import type { SongSortColumn } from '@/types/SongSortColumn';

import { LibraryProgress } from './library-progress';
import { LibraryToolbar, type SongListView } from './library-toolbar';
import { SongDetailsSidebar } from './song-details/song-details-sidebar';
import { SongList } from './song-list/song-list';
import type { SongItemProps } from './song-list/types';
import { songKey } from './song/song-key';

const hasFilters = (values: readonly unknown[]): boolean =>
  values.some((value) => (typeof value === 'string' ? value.trim() !== '' : Boolean(value)));

const songListSort = (config: AppConfig | undefined): readonly SongSort[] =>
  config?.song_list_sort ?? [];

const nextSongSort = (sorts: readonly SongSort[], column: SongSortColumn): SongSort[] | null => {
  const sortIndex = sorts.findIndex((sort) => sort.column === column);
  if (sortIndex === -1) {
    return [...sorts, { column, direction: 'ascending' }];
  }
  if (sorts[sortIndex].direction === 'ascending') {
    return sorts.map((sort, index) =>
      index === sortIndex ? { ...sort, direction: 'descending' } : sort,
    );
  }

  const nextSorts = sorts.filter((_, index) => index !== sortIndex);
  return nextSorts.length === 0 ? null : nextSorts;
};

type SongSidePanelProps = {
  queueOpen: boolean;
  playbackQueue: PlaybackQueueEntry[];
  song: Song | null;
  queueEntries?: Record<string, QueuedStatus>;
  onCloseQueue: () => void;
  onCloseSong: () => void;
};

function SongSidePanel({
  queueOpen,
  playbackQueue,
  song,
  queueEntries,
  onCloseQueue,
  onCloseSong,
}: SongSidePanelProps) {
  if (queueOpen) {
    return <QueueSidebar entries={playbackQueue} onClose={onCloseQueue} />;
  }
  if (song) {
    return (
      <SongDetailsSidebar
        key={songKey(song)}
        song={song}
        queueStatus={queueEntries?.[song.file_hash]}
        onClose={onCloseSong}
      />
    );
  }
  return null;
}

export const Library = () => {
  const { data: queue } = useAnalysisQueue();
  const { data: playbackQueue = [] } = usePlaybackQueueQuery();
  const { data: config } = useConfig();
  const { mutate: saveConfig, isPending: isSavingConfig } = useConfigMutation();
  const { focus, actionsRef, setFocus, selectedSong, setSelectedSong } = useMenuFocus();
  const { setScrollContainer, resetScroll } = usePersistentScroll('songList');
  const { search } = useSearch();
  const { artist, album, playlist, folder, query, status, transcript_source } = useLibraryFilter();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useSongs();
  const [queueOpen, setQueueOpen] = useState(false);
  const view: SongListView = config?.song_list_view === 'grid' ? 'grid' : 'table';
  const sort = songListSort(config);
  const songs = useMemo(() => data?.pages.flatMap((page) => page.processed) ?? [], [data]);
  const selectedKey = selectedSong ? songKey(selectedSong) : null;
  const currentSelectedSong = songs.find((song) => songKey(song) === selectedKey) ?? selectedSong;
  const filterKey = JSON.stringify([
    search,
    artist,
    album,
    playlist,
    folder,
    query,
    status,
    transcript_source,
    sort,
  ]);
  const previousFilterKeyRef = useRef(filterKey);
  const songsRef = useLatestRef(songs);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (previousFilterKeyRef.current === filterKey) {
      return;
    }
    previousFilterKeyRef.current = filterKey;

    resetScroll();
    setFocus((previous) => ({ ...previous, songIndex: 0 }));
  }, [filterKey, resetScroll, setFocus]);

  useEffect(() => {
    actionsRef.current.songCount = songs.length;
  }, [songs.length, actionsRef]);

  useEffect(() => {
    const actions = actionsRef.current;
    actions.onConfirmSong = (index: number) => {
      const song = songsRef.current.at(index);
      if (!song) {
        return;
      }

      setQueueOpen(false);
      setSelectedSong(song);
    };
    return () => {
      actions.onConfirmSong = null;
    };
  }, [actionsRef, setSelectedSong, songsRef]);

  useEffect(() => {
    const element = sentinelRef.current;
    if (!element) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage === true && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: '200px' },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const isSongListActive = focus.active && focus.panel === 'songList';
  const hasActiveFilter = hasFilters([
    search,
    artist,
    album,
    playlist,
    query,
    status,
    transcript_source,
  ]);
  const selectSong = useCallback(
    (song: (typeof songs)[number]) => {
      setQueueOpen(false);
      setSelectedSong(song);
    },
    [setSelectedSong],
  );
  const openQueue = () => {
    setSelectedSong(null);
    setQueueOpen(true);
    setFocus((previous) => ({ ...previous, active: true, panel: 'songDetails' }));
  };
  const sortSongs = (column: SongSortColumn) => {
    saveConfig({ song_list_sort: nextSongSort(sort, column) });
  };

  const getItemProps = (song: (typeof songs)[number], index: number): SongItemProps => ({
    song,
    queueStatus: queue?.entries[song.file_hash],
    index,
    isSelected: selectedKey === songKey(song),
    isFocused: isSongListActive && !focus.actionsFocused && focus.songIndex === index,
    onSelect: selectSong,
  });

  return (
    <div className="flex min-h-0 w-full flex-1 overflow-hidden">
      <main
        className={cn(
          'min-w-0 flex-1 flex-col gap-3 p-3 sm:p-4',
          currentSelectedSong || queueOpen ? 'hidden xl:flex' : 'flex',
        )}
      >
        <LibraryToolbar
          view={view}
          queueCount={playbackQueue.length}
          isSavingView={isSavingConfig}
          onOpenQueue={openQueue}
          onViewChange={(nextView) => saveConfig({ song_list_view: nextView })}
        />
        <Separator />
        <LibraryProgress />
        <SongList
          songs={songs}
          view={view}
          sort={sort}
          sortingDisabled={isSavingConfig}
          loading={isLoading}
          filtered={hasActiveFilter}
          getItemProps={getItemProps}
          setScrollContainer={setScrollContainer}
          sentinelRef={sentinelRef}
          onSort={sortSongs}
        />
      </main>

      <SongSidePanel
        queueOpen={queueOpen}
        playbackQueue={playbackQueue}
        song={currentSelectedSong}
        queueEntries={queue?.entries}
        onCloseQueue={() => setQueueOpen(false)}
        onCloseSong={() => setSelectedSong(null)}
      />
    </div>
  );
};
