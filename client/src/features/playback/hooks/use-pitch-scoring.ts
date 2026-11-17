import { useEffect, useRef, useState } from 'react';

import type { TimeSubscriber } from '@/features/playback/hooks/use-audio-player';
import {
  DEFAULT_MIC_LATENCY_COMPENSATION_SEC,
  MAX_MIC_LATENCY_COMPENSATION_SEC,
  MIN_MIC_LATENCY_COMPENSATION_SEC,
  PITCH_WINDOW_SAMPLES,
} from '@/features/playback/lib/pitch/constants';
import { createPitchDetector, detectPitchFromSamples } from '@/features/playback/lib/pitch/detect';
import type {
  PitchSeries,
  ReferencePitchTrack,
  SeriesNoteView,
} from '@/features/playback/lib/pitch/state';
import {
  analyzeReferencePitches,
  freqToSemitone,
  PitchScoring,
  PitchStateBuffer,
  pitchSimilarity,
  sampleVocalsWindow,
} from '@/features/playback/lib/pitch/state';
import { buildNoteView, voiceAnchor } from '@/features/playback/lib/scoring/note-display';
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTY_TOLERANCE,
  NoteScoring,
  type Difficulty,
  type LineResult,
  type ScoreNote,
} from '@/features/playback/lib/scoring/note-scoring';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';

export type PitchScoringSource = {
  isReady: boolean;
  duration: number;
  getReferenceBuffer: () => AudioBuffer | null;
  subscribe: (fn: TimeSubscriber) => () => void;
};

/** Live details of note scoring; `null` for songs scored without notes. */
export type LiveScoreStats = {
  combo: number;
  maxCombo: number;
  /** 0..100 over the notes finished so far. */
  accuracyPct: number;
  /** Lines the playhead has passed, in song order. */
  lines: LineResult[];
};

function nextStats(prev: LiveScoreStats | null, scoring: NoteScoring): LiveScoreStats {
  const summary = scoring.summary();
  const lines = scoring.lineResults().filter((line) => line.finished);
  const accuracyPct = Math.round(summary.accuracy * 100);
  const unchanged =
    prev !== null &&
    prev.combo === summary.combo &&
    prev.maxCombo === summary.maxCombo &&
    prev.accuracyPct === accuracyPct &&
    prev.lines.length === lines.length;
  return unchanged
    ? prev
    : { combo: summary.combo, maxCombo: summary.maxCombo, accuracyPct, lines };
}

function seriesNoteView(
  notes: readonly ScoreNote[] | null,
  difficulty: Difficulty,
): SeriesNoteView | null {
  const view = notes === null ? null : buildNoteView(notes);
  return view === null ? null : { ...view, tolerance: DIFFICULTY_TOLERANCE[difficulty] };
}

const frameSimilarity = (refHz: number | null, userHz: number | null): number =>
  refHz !== null && userHz !== null ? pitchSimilarity(refHz, userHz) : 0;

export type PitchScoringOptions = {
  latencyCompensationSec?: number;
  /** Notes to score against; `null` keeps the frame-similarity scoring. */
  notes?: readonly ScoreNote[] | null;
  difficulty?: Difficulty;
};

export function usePitchScoring(
  { isReady, duration, getReferenceBuffer, subscribe }: PitchScoringSource,
  micPitch: number | null,
  {
    latencyCompensationSec = DEFAULT_MIC_LATENCY_COMPENSATION_SEC,
    notes = null,
    difficulty = DEFAULT_DIFFICULTY,
  }: PitchScoringOptions = {},
) {
  const refDetector = useRef(createPitchDetector());
  const scratchRef = useRef(new Float32Array(PITCH_WINDOW_SAMPLES));
  const bufferRef = useRef(new PitchStateBuffer());
  const scoringRef = useRef(new PitchScoring(1));
  // Songs with notes are scored by notes (0..10000); the rest keep the
  // frame-similarity score (0..1000).
  const noteScoringRef = useRef<NoteScoring | null>(null);
  const noteViewRef = useRef<SeriesNoteView | null>(null);
  const referenceTrackRef = useRef<ReferencePitchTrack | null>(null);
  const micPitchRef = useLatestRef(micPitch);
  const latencyRef = useLatestRef(
    Math.min(
      MAX_MIC_LATENCY_COMPENSATION_SEC,
      Math.max(MIN_MIC_LATENCY_COMPENSATION_SEC, latencyCompensationSec),
    ),
  );
  const [series, setSeries] = useState<PitchSeries>({
    refPitches: [],
    userPitches: [],
    displaySemitones: [],
    similarities: [],
    times: [],
    referenceTrack: null,
    referenceTime: 0,
    currentTime: 0,
  });
  const [score, setScore] = useState(0);
  const [stats, setStats] = useState<LiveScoreStats | null>(null);

  useEffect(() => {
    if (!isReady || duration <= 0) {
      return;
    }
    bufferRef.current.reset();

    const reference = getReferenceBuffer();
    const track = reference ? analyzeReferencePitches(reference) : null;
    bufferRef.current.setOctaveAnchor(track?.octaveAnchorSemitone ?? null);
    referenceTrackRef.current = track;
    scoringRef.current = new PitchScoring(track?.singableTime ?? duration);
    noteScoringRef.current =
      notes !== null && notes.length > 0 ? new NoteScoring(notes, difficulty) : null;
    noteViewRef.current = seriesNoteView(notes, difficulty);

    setSeries(bufferRef.current.snapshot());
    setScore(0);
    setStats(null);
  }, [isReady, duration, getReferenceBuffer, notes, difficulty]);

  useEffect(() => {
    if (!isReady) {
      return undefined;
    }

    const run = (t: number) => {
      const reference = getReferenceBuffer();
      const track = referenceTrackRef.current;
      const mp = micPitchRef.current;
      const referenceTime = Math.max(0, t - latencyRef.current);
      const refHz =
        reference && sampleVocalsWindow(reference, t, scratchRef.current, latencyRef.current)
          ? detectPitchFromSamples(refDetector.current, scratchRef.current, reference.sampleRate)
          : null;
      const noteScoring = noteScoringRef.current;
      const userSemitone = mp === null ? null : freqToSemitone(mp);
      // With notes, the voice line is coloured by the same rule that scores it.
      const sim =
        noteScoring === null
          ? frameSimilarity(refHz, mp)
          : noteScoring.frameQuality(referenceTime, userSemitone);

      const noteView = noteViewRef.current;
      bufferRef.current.setNoteAnchor(
        noteView === null ? null : voiceAnchor(noteView, referenceTime),
      );
      bufferRef.current.tryPush(refHz, mp, sim, t);
      if (noteScoring === null) {
        scoringRef.current.accumulate(t, refHz, mp, sim);
      } else {
        // The voice heard now was sung `latency` ago.
        noteScoring.accumulate(referenceTime, userSemitone);
      }

      const snapshot = bufferRef.current.snapshot();
      snapshot.referenceTrack = track;
      snapshot.referenceTime = referenceTime;
      snapshot.currentTime = t;
      snapshot.noteView = noteView;
      setSeries(snapshot);
      if (noteScoring === null) {
        setScore(scoringRef.current.score());
      } else {
        setScore(noteScoring.summary().score);
        setStats((prev) => nextStats(prev, noteScoring));
      }
    };

    return subscribe(run);
  }, [getReferenceBuffer, isReady, latencyRef, micPitchRef, subscribe]);

  return { series, score, stats };
}
