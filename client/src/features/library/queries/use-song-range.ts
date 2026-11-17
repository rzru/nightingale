import { useQuery } from '@tanstack/react-query';

import { loadTranscript } from '@/bridge/playback';
import { isLowQuality } from '@/features/library/utils/transcript-quality';
import { SONG_RANGE } from '@/shared/query-keys';
import type { PitchRange } from '@/types/Transcript';

export type SongTranscriptInfo = {
  range: PitchRange | null;
  lyricsOffsetMs: number;
  /** Many words have a doubtful timing: the lyrics likely need a manual check. */
  lowQuality: boolean;
};

const EMPTY_INFO: SongTranscriptInfo = { range: null, lyricsOffsetMs: 0, lowQuality: false };

/** Vocal range and lyrics offset of an analyzed song, read from its transcript. */
export const useSongRange = (fileHash: string | null) =>
  useQuery({
    queryKey: [...SONG_RANGE, fileHash],
    queryFn: async (): Promise<SongTranscriptInfo> => {
      if (fileHash === null) {
        return EMPTY_INFO;
      }
      try {
        const transcript = await loadTranscript(fileHash);
        return {
          range: transcript.range ?? null,
          lyricsOffsetMs: transcript.lyrics_offset_ms ?? 0,
          lowQuality: isLowQuality(transcript),
        };
      } catch {
        return EMPTY_INFO;
      }
    },
    enabled: fileHash !== null,
  });
