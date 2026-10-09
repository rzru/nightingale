import { atom, useAtom } from 'jotai';

import { EMPTY_LIBRARY_FILTER } from '@/features/library/lib/library-menu-filter';
import type { LibraryMenuFilters } from '@/types/LibraryMenuFilters';

export const libraryFilterAtom = atom<LibraryMenuFilters>(EMPTY_LIBRARY_FILTER);

export const useLibraryFilter = () => {
  const [filter, setLibraryFilter] = useAtom(libraryFilterAtom);

  return {
    artist: filter.artist,
    album: filter.album,
    playlist: filter.playlist,
    folder: filter.folder,
    query: filter.query,
    status: filter.status,
    transcript_source: filter.transcript_source,
    search: filter.search,
    setLibraryFilter,
  };
};

export type { LibraryMenuFilters } from '@/types/LibraryMenuFilters';
export type { LibraryMenuSection } from '@/features/library/lib/library-menu-filter';
