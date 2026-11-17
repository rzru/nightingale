import type { SavedSegment } from '@/features/timing-editor/lib/model';
import type { Transcript } from '@/types/Transcript';

import { invoke } from './runtime';

/** The transcript as stored (original tempo and key), for the timing editor. */
export const loadBaseTranscript = async (fileHash: string): Promise<Transcript> => {
  return await invoke<Transcript>('load_base_transcript', { fileHash });
};

/** Save hand-edited lines; notes are re-cut from the cached pitch curve. */
export const saveTranscriptEdits = async (
  fileHash: string,
  segments: SavedSegment[],
): Promise<void> => {
  return await invoke<void>('save_transcript_edits', { fileHash, segments });
};
