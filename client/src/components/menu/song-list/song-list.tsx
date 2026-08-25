import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useMenuFocus } from "@/contexts/menu-focus-context";
import { useLibraryFilter } from "@/hooks/use-library-filter";
import { usePersistentScroll } from "@/hooks/use-persistent-scroll";
import { useSearch } from "@/hooks/use-search";
import { useConfigMutation } from "@/mutations/use-config-mutation";
import { useConfig } from "@/queries/use-config";
import { useAnalysisQueue, useSongs } from "@/queries/use-songs";
import { useEffect, useMemo, useRef, useState } from "react";
import { Filters, type SongListView } from "./filters";
import { Progress } from "./progress";
import { songKey } from "./shared/song-key";
import { SongDetailsSidebar } from "./song-details-sidebar";
import type { SongItemProps } from "./types";
import { SongGrid } from "./views/song-grid";
import { SongTable, type SongSortColumn, type SongSortDirection } from "./views/song-table";
import { getSongStatusInfo } from "./shared/song-status";

export const SongList = () => {
  const { data: queue } = useAnalysisQueue();
  const { data: config } = useConfig();
  const { mutate: saveConfig, isPending: isSavingView } = useConfigMutation();
  const { focus, actionsRef, setFocus, selectedSongKeyRef } = useMenuFocus();
  const { setScrollContainer, resetScroll } = usePersistentScroll("songList");
  const { search } = useSearch();
  const { artist, album, playlist, query, status, transcript_source } = useLibraryFilter();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useSongs();
  // Track the selection by a rekey-stable key (see `songKey`) rather than by
  // file_hash, and seed from the persisted ref so returning from playback
  // restores the open sidebar and the selected row/card highlight.
  const [selectedKey, setSelectedKey] = useState<string | null>(() => selectedSongKeyRef.current);
  const [sortColumn, setSortColumn] = useState<SongSortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SongSortDirection>(null);

  const view: SongListView = config?.song_list_view === "grid" ? "grid" : "table";
  const songs = useMemo(() => data?.pages.flatMap((page) => page.processed) ?? [], [data]);
  const sortedSongs = useMemo(() => {
    if (!sortColumn || !sortDirection) return songs;

    return [...songs].sort((a, b) => {
      let comparison: number;
      if (sortColumn === "duration") {
        comparison = a.duration_secs - b.duration_secs;
      } else {
        const aValue =
          sortColumn === "song"
            ? a.title
            : sortColumn === "band"
              ? a.artist
              : sortColumn === "album"
                ? a.album
                : getSongStatusInfo(a.is_analyzed, queue?.entries[a.file_hash]).label;
        const bValue =
          sortColumn === "song"
            ? b.title
            : sortColumn === "band"
              ? b.artist
              : sortColumn === "album"
                ? b.album
                : getSongStatusInfo(b.is_analyzed, queue?.entries[b.file_hash]).label;
        comparison = aValue.localeCompare(bValue, undefined, { sensitivity: "base" });
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [songs, sortColumn, sortDirection, queue?.entries]);
  const foundSong = songs.find((song) => songKey(song) === selectedKey) ?? null;
  // Keep the details sidebar open even when the selected song temporarily drops
  // out of the loaded pages — e.g. it leaves the analysis queue and re-sorts to
  // a position we haven't paged to yet. Fall back to the last snapshot for the
  // same key so the sidebar doesn't flicker closed on status transitions.
  const lastSelectedSongRef = useRef<(typeof songs)[number] | null>(null);
  if (foundSong) {
    lastSelectedSongRef.current = foundSong;
  }
  const selectedSong =
    foundSong ??
    (selectedKey &&
    lastSelectedSongRef.current &&
    songKey(lastSelectedSongRef.current) === selectedKey
      ? lastSelectedSongRef.current
      : null);
  const filterKey = JSON.stringify([
    search,
    artist,
    album,
    playlist,
    query,
    status,
    transcript_source,
  ]);
  const previousFilterKeyRef = useRef(filterKey);
  const songsRef = useRef(sortedSongs);
  const sentinelRef = useRef<HTMLDivElement>(null);
  songsRef.current = sortedSongs;

  useEffect(() => {
    if (previousFilterKeyRef.current === filterKey) return;
    previousFilterKeyRef.current = filterKey;

    setSelectedKey(null);
    resetScroll();
    setFocus((previous) => ({ ...previous, songIndex: 0 }));
  }, [filterKey, resetScroll, setFocus]);

  useEffect(() => {
    selectedSongKeyRef.current = selectedKey;
  }, [selectedKey, selectedSongKeyRef]);

  useEffect(() => {
    actionsRef.current.songCount = songs.length;
  }, [songs.length, actionsRef]);

  useEffect(() => {
    actionsRef.current.onConfirmSong = (index: number) => {
      const song = songsRef.current[index];
      if (!song) return;

      setSelectedKey(songKey(song));
    };
    return () => {
      actionsRef.current.onConfirmSong = null;
    };
  }, [actionsRef]);

  useEffect(() => {
    const element = sentinelRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: "200px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, view]);

  const isSongListActive = focus.active && focus.panel === "songList";
  const hasActiveFilter = Boolean(
    search.trim() || artist || album || playlist || query || status || transcript_source,
  );
  const showEmptyState = songs.length === 0 && !isLoading;
  const selectSong = (song: (typeof songs)[number]) => setSelectedKey(songKey(song));
  const handleSortChange = (column: SongSortColumn) => {
    if (sortColumn !== column) {
      setSortColumn(column);
      setSortDirection("asc");
    } else if (sortDirection === "asc") {
      setSortDirection("desc");
    } else if (sortDirection === "desc") {
      setSortColumn(null);
      setSortDirection(null);
    } else {
      setSortDirection("asc");
    }
  };

  const getItemProps = (song: (typeof songs)[number], index: number): SongItemProps => ({
    song,
    queueStatus: queue?.entries[song.file_hash],
    index,
    isSelected: selectedKey === songKey(song),
    isFocused: isSongListActive && !focus.analyzeAllFocused && focus.songIndex === index,
    onSelect: () => selectSong(song),
  });

  return (
    <div className="flex min-h-0 w-full flex-1 overflow-hidden">
      <main
        className={cn(
          "min-w-0 flex-1 flex-col gap-3 p-3 sm:p-4",
          selectedSong ? "hidden xl:flex" : "flex",
        )}
      >
        <Filters
          view={view}
          isSavingView={isSavingView}
          onViewChange={(nextView) => saveConfig({ song_list_view: nextView })}
        />
        <Separator />
        <Progress />
        {showEmptyState ? (
          <Empty className="px-4">
            <EmptyHeader>
              <EmptyTitle>{hasActiveFilter ? "No results" : "No songs found"}</EmptyTitle>
              <EmptyDescription>
                {hasActiveFilter
                  ? "No songs match your search or filters. Try adjusting them."
                  : "This library is empty or still being scanned."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div
            ref={setScrollContainer}
            data-song-layout={view}
            className="themed-scrollbar song-table-shell min-h-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          >
            {view === "table" ? (
              <SongTable
                songs={sortedSongs}
                getItemProps={getItemProps}
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSortChange={handleSortChange}
              />
            ) : (
              <SongGrid songs={sortedSongs} getItemProps={getItemProps} />
            )}
            <div ref={sentinelRef} className="h-1" aria-hidden="true" />
          </div>
        )}
      </main>

      {selectedSong ? (
        <SongDetailsSidebar
          key={songKey(selectedSong)}
          song={selectedSong}
          queueStatus={queue?.entries[selectedSong.file_hash]}
          onClose={() => setSelectedKey(null)}
        />
      ) : null}
    </div>
  );
};
