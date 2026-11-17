import { useMemo } from 'react';

import { starsScore } from '@/features/playback/utils/result';
import { useProfiles } from '@/features/profiles/queries/use-profiles';
import type { ScoreRecord } from '@/types/ScoreRecord';

function beatsBest(
  record: ScoreRecord,
  bestVersion: number | undefined,
  bestStars: number | undefined,
): boolean {
  if (bestVersion === undefined || bestStars === undefined || record.version > bestVersion) {
    return true;
  }
  return record.version === bestVersion && starsScore(record.score, record.version) > bestStars;
}

/**
 * Best result per song for the star rating, on the 0..1000 stars scale.
 * Records of the newest scoring version of a song win over older ones.
 */
export function useBestScoresBySongForActiveProfile(): Map<string, number> {
  const { data } = useProfiles();
  const active = data?.active;
  const scores = data?.scores;

  return useMemo(() => {
    const map = new Map<string, number>();
    const versions = new Map<string, number>();
    if (typeof active !== 'string' || active === '') {
      return map;
    }

    for (const r of scores ?? []) {
      if (r.profile !== active) {
        continue;
      }

      if (beatsBest(r, versions.get(r.song_hash), map.get(r.song_hash))) {
        versions.set(r.song_hash, r.version);
        map.set(r.song_hash, starsScore(r.score, r.version));
      }
    }

    return map;
  }, [active, scores]);
}
