import { useEffect, useRef, useState } from 'react';

import type { TimeSubscriber } from '@/features/playback/hooks/use-audio-player';
import {
  DEFAULT_MIC_LATENCY_COMPENSATION_SEC,
  MAX_MIC_LATENCY_COMPENSATION_SEC,
  MIN_MIC_LATENCY_COMPENSATION_SEC,
  PITCH_WINDOW_SAMPLES,
} from '@/features/playback/lib/pitch/constants';
import {
  createPitchDetector,
  detectPitchFromSamplesRef,
} from '@/features/playback/lib/pitch/detect';
import type { PitchSeries } from '@/features/playback/lib/pitch/state';
import {
  computeSingableTime,
  PitchScoring,
  PitchStateBuffer,
  pitchSimilarity,
  sampleVocalsWindow,
} from '@/features/playback/lib/pitch/state';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';

export type PitchScoringSource = {
  isReady: boolean;
  duration: number;
  getReferenceBuffer: () => AudioBuffer | null;
  subscribe: (fn: TimeSubscriber) => () => void;
};

export function usePitchScoring(
  { isReady, duration, getReferenceBuffer, subscribe }: PitchScoringSource,
  micPitch: number | null,
  latencyCompensationSec = DEFAULT_MIC_LATENCY_COMPENSATION_SEC,
) {
  const refDetector = useRef(createPitchDetector());
  const scratchRef = useRef(new Float32Array(PITCH_WINDOW_SAMPLES));
  const bufferRef = useRef(new PitchStateBuffer());
  const scoringRef = useRef(new PitchScoring(1));
  const micPitchRef = useLatestRef(micPitch);
  const latencyRef = useLatestRef(
    Math.min(
      MAX_MIC_LATENCY_COMPENSATION_SEC,
      Math.max(MIN_MIC_LATENCY_COMPENSATION_SEC, latencyCompensationSec),
    ),
  );
  const singableRef = useRef<number | null>(null);
  const [series, setSeries] = useState<PitchSeries>({
    refPitches: [],
    userPitches: [],
    similarities: [],
  });
  const [score, setScore] = useState(0);

  useEffect(() => {
    if (!isReady || duration <= 0) {
      return;
    }
    bufferRef.current.reset();

    const reference = getReferenceBuffer();
    const singable = reference ? computeSingableTime(reference) : duration;
    singableRef.current = singable;
    scoringRef.current = new PitchScoring(singable);

    setSeries(bufferRef.current.snapshot());
    setScore(0);
  }, [isReady, duration, getReferenceBuffer]);

  useEffect(() => {
    if (!isReady) {
      return undefined;
    }

    const run = (t: number) => {
      const reference = getReferenceBuffer();
      const mp = micPitchRef.current;
      const refHz =
        reference && sampleVocalsWindow(reference, t, scratchRef.current, latencyRef.current)
          ? detectPitchFromSamplesRef(refDetector.current, scratchRef.current, reference.sampleRate)
          : null;
      const sim = refHz !== null && mp !== null ? pitchSimilarity(refHz, mp) : 0;

      bufferRef.current.tryPush(refHz, mp, sim, t);
      scoringRef.current.accumulate(t, refHz, mp, sim);

      setSeries(bufferRef.current.snapshot());
      setScore(scoringRef.current.score());
    };

    return subscribe(run);
  }, [getReferenceBuffer, isReady, latencyRef, micPitchRef, subscribe]);

  return { series, score };
}
