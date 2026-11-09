import { useQuery } from '@tanstack/react-query';

import { loadSongsByHashes } from '@/bridge/songs';

/**
 * Resolves a room's track hash against the local library. The node's own title
 * is a claim; this is the truth, and it is also what decides "can I sing this".
 */
export const useRoomSongs = (hashes: string[]) => {
  const key = [...new Set(hashes)].toSorted().join(',');

  return useQuery({
    queryKey: ['rooms-songs', key],
    queryFn: () => loadSongsByHashes(key === '' ? [] : key.split(',')),
    enabled: key !== '',
  });
};

export const songLabel = (song: { artist: string; title: string }): string =>
  `${song.artist} — ${song.title}`;
