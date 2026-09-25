import { useQuery } from '@tanstack/react-query';

import { loadLyrics, loadSidecarLrc, searchLrclibLyrics } from '@/bridge/lyrics';
import { loadTranscript } from '@/bridge/playback';
import { linesFromTranscript } from '@/features/lyrics/utils/edit-lyrics';
import { LRCLIB, LYRICS, SIDECAR_LRC } from '@/shared/query-keys';
import type { LrclibCandidate } from '@/types/LrclibCandidate';
import type { SidecarLrc } from '@/types/SidecarLrc';

const fetchInitialLyrics = async (fileHash: string): Promise<string> => {
  const file = await loadLyrics(fileHash);
  if (file && file.lines.length > 0) {
    return file.lines.join('\n');
  }
  try {
    const transcript = await loadTranscript(fileHash);
    return linesFromTranscript(transcript);
  } catch {
    return '';
  }
};

const requireFileHash = (fileHash: string | null): string => {
  if (fileHash === null) {
    throw new Error('Lyrics query requires a file hash');
  }
  return fileHash;
};

export const useInitialLyrics = (fileHash: string | null) =>
  useQuery({
    queryKey: [...LYRICS, fileHash],
    queryFn: () => fetchInitialLyrics(requireFileHash(fileHash)),
    enabled: fileHash !== null,
    staleTime: Infinity,
  });

export const useLrclibCandidates = (fileHash: string | null) =>
  useQuery<LrclibCandidate[]>({
    queryKey: [...LRCLIB, fileHash],
    queryFn: () => searchLrclibLyrics(requireFileHash(fileHash)),
    enabled: fileHash !== null,
    staleTime: Infinity,
  });

export const useSidecarLrc = (fileHash: string | null) =>
  useQuery<SidecarLrc | null>({
    queryKey: [...SIDECAR_LRC, fileHash],
    queryFn: () => loadSidecarLrc(requireFileHash(fileHash)),
    enabled: fileHash !== null,
    staleTime: Infinity,
  });
