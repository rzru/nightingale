import { useQuery } from '@tanstack/react-query';

import { loadTranscript } from '@/bridge/playback';
import {
  scoreNotesFromSegments,
  type ScoreNote,
} from '@/features/playback/lib/scoring/note-scoring';
import { SCORE_NOTES } from '@/shared/query-keys';

/**
 * Notes the current song is scored against, or `null` while loading and for
 * songs without notes (those keep the frame-similarity scoring).
 */
export function useScoreNotes(fileHash: string): readonly ScoreNote[] | null {
  const { data } = useQuery({
    queryKey: [...SCORE_NOTES, fileHash],
    queryFn: async (): Promise<ScoreNote[] | null> => {
      try {
        const notes = scoreNotesFromSegments((await loadTranscript(fileHash)).segments);
        return notes.some((note) => note.type !== 'free') ? notes : null;
      } catch {
        return null;
      }
    },
    // A refetch mid-song would swap the notes and restart the score.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return data ?? null;
}
