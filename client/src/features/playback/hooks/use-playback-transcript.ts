/**
 * Loads the transcript for the current track and normalizes segments for display.
 */

import { useEffect, useState } from 'react';

import { loadTranscript } from '@/bridge/playback';
import { splitLongSegments } from '@/features/playback/utils/transcript-segments';
import { t } from '@/i18n';
import type { Segment, Transcript } from '@/types/Transcript';

export function usePlaybackTranscript(fileHash: string) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [transcriptSource, setTranscriptSource] = useState('generated');
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void loadTranscript(fileHash)
      .then((transcript: Transcript) => {
        if (!cancelled) {
          setSegments(splitLongSegments(transcript.segments));
          setTranscriptSource(transcript.source ?? 'generated');
          setIsReady(true);
        }
        return undefined;
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(
            t('playback.lyrics.loadError', {
              error: reason instanceof Error ? reason.message : String(reason),
            }),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fileHash]);

  return { segments, transcriptSource, isReady, error };
}
