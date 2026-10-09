import type { LibraryMenuFilters } from '@/types/LibraryMenuFilters';
import type { LibraryMenuItem } from '@/types/LibraryMenuItem';

export type LibraryMenuSection =
  | 'hot'
  | 'no_metadata'
  | 'artists'
  | 'albums'
  | 'playlists'
  | 'folders';

export const EMPTY_LIBRARY_FILTER: LibraryMenuFilters = {
  artist: null,
  album: null,
  playlist: null,
  query: null,
  status: null,
  transcript_source: null,
  search: null,
  folder: null,
};

const HOT_FILTERS: Record<string, LibraryMenuFilters> = {
  all: { ...EMPTY_LIBRARY_FILTER },
  queued: { ...EMPTY_LIBRARY_FILTER, query: 'queued' },
  analysed: { ...EMPTY_LIBRARY_FILTER, query: 'analysed' },
  videos: { ...EMPTY_LIBRARY_FILTER, query: 'videos' },
  usdx: { ...EMPTY_LIBRARY_FILTER, query: 'usdx' },
};

const NO_METADATA_FILTERS: Record<string, LibraryMenuFilters> = {
  unknown_artist: { ...EMPTY_LIBRARY_FILTER, artist: 'unknown_artist' },
  unknown_album: { ...EMPTY_LIBRARY_FILTER, album: 'unknown_album' },
};

export function libraryFilterFromMenuSelection(
  section: LibraryMenuSection,
  item: LibraryMenuItem,
): LibraryMenuFilters {
  switch (section) {
    case 'hot':
      return HOT_FILTERS[item.value] ?? EMPTY_LIBRARY_FILTER;
    case 'no_metadata':
      return NO_METADATA_FILTERS[item.value] ?? EMPTY_LIBRARY_FILTER;
    case 'artists':
      return { ...EMPTY_LIBRARY_FILTER, artist: item.value };
    case 'albums':
      return { ...EMPTY_LIBRARY_FILTER, album: item.value };
    case 'playlists':
      return { ...EMPTY_LIBRARY_FILTER, playlist: item.value };
    case 'folders':
      return { ...EMPTY_LIBRARY_FILTER, folder: item.value };
  }
  section satisfies never;
  return EMPTY_LIBRARY_FILTER;
}

export function libraryFiltersEqual(a: LibraryMenuFilters, b: LibraryMenuFilters): boolean {
  return (
    a.artist === b.artist &&
    a.album === b.album &&
    a.playlist === b.playlist &&
    a.folder === b.folder &&
    a.query === b.query
  );
}

export function isLibraryMenuItemActive(
  section: LibraryMenuSection,
  item: LibraryMenuItem,
  current: LibraryMenuFilters,
): boolean {
  return libraryFiltersEqual(current, libraryFilterFromMenuSelection(section, item));
}
