import type { ScoreRecord } from '@/types/ScoreRecord';

/** Frame-similarity scoring, 0..1000. */
export const LEGACY_SCORING_VERSION = 1;
/** Note scoring, 0..10000. */
export const NOTE_SCORING_VERSION = 2;

export function halfStarUnits(score: number): number {
  return Math.min(10, Math.round(score / 100));
}

/** Bring a score of any scoring version to the 0..1000 scale the stars use. */
export function starsScore(score: number, version: number): number {
  return version >= NOTE_SCORING_VERSION ? score / 10 : score;
}

/** Newest scoring version a song has records for. */
export function songScoringVersion(records: readonly ScoreRecord[], songHash: string): number {
  let version = LEGACY_SCORING_VERSION;
  for (const record of records) {
    if (record.song_hash === songHash && record.version > version) {
      version = record.version;
    }
  }
  return version;
}

export function topScoresForSong(
  records: ScoreRecord[],
  songHash: string,
  limit: number,
  version: number = songScoringVersion(records, songHash),
): ScoreRecord[] {
  const best = new Map<string, ScoreRecord>();

  for (const record of records) {
    // Scores of different scoring versions use different scales.
    if (record.song_hash !== songHash || record.version !== version) {
      continue;
    }

    const previous = best.get(record.profile);
    if (previous === undefined || record.score > previous.score) {
      best.set(record.profile, record);
    }
  }

  return [...best.values()].toSorted((a, b) => b.score - a.score).slice(0, limit);
}
