import { z } from 'zod';

import type { LrclibCandidate } from '@/types/LrclibCandidate';
import type { LyricsFile } from '@/types/LyricsFile';
import type { SidecarLrc } from '@/types/SidecarLrc';

import { invoke } from './runtime';

const sidecarLrcSchema = z.object({
  text: z.string(),
  file_name: z.string(),
  kind: z.enum(['lrc', 'elrc']),
}) satisfies z.ZodType<SidecarLrc>;

export const loadLyrics = async (fileHash: string): Promise<LyricsFile | null> => {
  return await invoke<LyricsFile | null>('load_lyrics', { fileHash });
};

export const loadSidecarLrc = async (fileHash: string): Promise<SidecarLrc | null> => {
  const value = await invoke('load_sidecar_lrc', { fileHash });
  return value === null ? null : sidecarLrcSchema.parse(value);
};

export const searchLrclibLyrics = async (fileHash: string): Promise<LrclibCandidate[]> => {
  return await invoke<LrclibCandidate[]>('search_lrclib_lyrics', { fileHash });
};

export const saveLyrics = async (fileHash: string, lines: string[]): Promise<void> => {
  return await invoke<void>('save_lyrics', { fileHash, lines });
};

export const provideLrc = async (
  fileHash: string,
  lrcText: string,
  separateStems: boolean,
): Promise<void> => {
  return await invoke<void>('provide_lrc', { fileHash, lrcText, separateStems });
};

export const applyTimedLyrics = async (fileHash: string, lrcText: string): Promise<void> => {
  return await invoke<void>('apply_timed_lyrics', { fileHash, lrcText });
};
