/**
 * Rough quality of a song's lyrics timing, from what the analyzer reports per
 * word: an alignment score and an "estimated" flag for words whose time was
 * interpolated. Pure module, shared by the app and the Node tests.
 */

type QualityWord = {
  score?: number;
  estimated?: boolean;
};

type QualitySegment = {
  words: QualityWord[];
};

/** A word below this alignment score is likely misplaced or misheard. */
export const LOW_WORD_SCORE = 0.3;
/** Share of doubtful words from which the song gets a warning. */
export const LOW_QUALITY_SHARE = 0.2;
/** Too few words to judge. */
const MIN_WORDS = 20;

const isDoubtful = (word: QualityWord): boolean =>
  word.estimated === true || (typeof word.score === 'number' && word.score < LOW_WORD_SCORE);

/** Share of doubtful words, 0..1; `null` when the transcript carries no scores. */
export function doubtfulWordShare(segments: readonly QualitySegment[]): number | null {
  const words = segments.flatMap((segment) => segment.words);
  const judged = words.filter((word) => word.estimated === true || typeof word.score === 'number');
  if (judged.length < MIN_WORDS) {
    return null;
  }
  return judged.filter(isDoubtful).length / words.length;
}

/**
 * Share of the sung time with no lyrics under it, from which a song gets a
 * warning. Measured: songs with known lyrics stay under 6 %, recognition that
 * skipped lines reaches 12-32 %.
 */
export const UNCOVERED_VOICE_LIMIT = 0.1;

type QualityTranscript = {
  segments: readonly QualitySegment[];
  quality?: { uncovered_voice: number | null };
};

export function isLowQuality(transcript: QualityTranscript): boolean {
  const uncovered = transcript.quality?.uncovered_voice ?? null;
  if (uncovered !== null && uncovered >= UNCOVERED_VOICE_LIMIT) {
    return true;
  }
  const share = doubtfulWordShare(transcript.segments);
  return share !== null && share >= LOW_QUALITY_SHARE;
}
