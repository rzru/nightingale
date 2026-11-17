// Acceptance checks for the whole chain "sound -> pitch -> score" (spec FR-6,
// FR-7): synthesized audio goes through the same pitch detector the microphone
// uses, then into note scoring. No live microphone is involved.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PITCH_WINDOW_SAMPLES } from '../src/features/playback/lib/pitch/constants.ts';
import {
  createPitchDetector,
  detectPitchFromSamples,
} from '../src/features/playback/lib/pitch/detect.ts';
import { freqToSemitone } from '../src/features/playback/lib/pitch/state.ts';
import {
  MAX_SCORE,
  NoteScoring,
  scoreNotesFromSegments,
} from '../src/features/playback/lib/scoring/note-scoring.ts';

const SAMPLE_RATE = 48_000;
/** The app reads the microphone pitch about 30 times a second. */
const UPDATE_SEC = 1 / 30;
const MELODY = [57, 59, 60, 62, 64, 62, 60, 59, 57, 60, 64, 69, 67, 64, 60, 59];

/** 4 lines of 8 notes: 0.5 s notes, 0.1 s gaps, 1 s between lines. */
function song() {
  const segments = [];
  let t = 1;
  for (let line = 0; line < 4; line++) {
    const words = [];
    for (let i = 0; i < 8; i++) {
      const pitch = MELODY[(line * 3 + i) % MELODY.length];
      words.push({
        start: t,
        end: t + 0.5,
        notes: [{ start: t, end: t + 0.5, pitch, type: 'normal' }],
      });
      t += 0.6;
    }
    segments.push({ words });
    t += 1;
  }
  return { notes: scoreNotesFromSegments(segments), duration: t };
}

const midiToHz = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** A voice-like tone: fundamental plus two harmonics, phase-continuous. */
function synthesize(duration, pitchAt) {
  const samples = new Float32Array(Math.ceil(duration * SAMPLE_RATE));
  let phase = 0;
  for (let i = 0; i < samples.length; i++) {
    const midi = pitchAt(i / SAMPLE_RATE);
    if (midi === null) {
      phase = 0;
      continue;
    }
    phase += (2 * Math.PI * midiToHz(midi)) / SAMPLE_RATE;
    samples[i] = 0.3 * Math.sin(phase) + 0.12 * Math.sin(2 * phase) + 0.06 * Math.sin(3 * phase);
  }
  return samples;
}

function whiteNoise(duration, amplitude) {
  let seed = 987654321;
  const samples = new Float32Array(Math.ceil(duration * SAMPLE_RATE));
  for (let i = 0; i < samples.length; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    samples[i] = (seed / 1073741824 - 1) * amplitude;
  }
  return samples;
}

/** Feed audio through the microphone pitch detector into note scoring. */
function scoreAudio(samples, difficulty) {
  const { notes } = song();
  const scoring = new NoteScoring(notes, difficulty);
  const detector = createPitchDetector();
  const window = new Float32Array(PITCH_WINDOW_SAMPLES);
  const duration = samples.length / SAMPLE_RATE;
  for (let t = UPDATE_SEC; t <= duration; t += UPDATE_SEC) {
    const end = Math.floor(t * SAMPLE_RATE);
    const start = end - PITCH_WINDOW_SAMPLES;
    let hz = null;
    if (start >= 0) {
      window.set(samples.subarray(start, end));
      hz = detectPitchFromSamples(detector, window, SAMPLE_RATE);
    }
    // The detector hears the middle of its window: half a window ago.
    const heardAt = t - PITCH_WINDOW_SAMPLES / SAMPLE_RATE / 2;
    scoring.accumulate(heardAt, hz === null ? null : freqToSemitone(hz));
  }
  return (100 * scoring.summary().score) / MAX_SCORE;
}

function melodyAt(notes, shift = 0) {
  return (time) => {
    const note = notes.find((n) => time >= n.start && time < n.end);
    return note ? note.pitch + shift : null;
  };
}

test('a 440 Hz tone is detected as A4 within 10 cents', () => {
  const detector = createPitchDetector();
  const tone = synthesize(0.2, () => 69);
  const hz = detectPitchFromSamples(detector, tone.subarray(0, PITCH_WINDOW_SAMPLES), SAMPLE_RATE);
  assert.ok(hz !== null);
  assert.ok(Math.abs(freqToSemitone(hz) - 69) <= 0.1, `${hz}`);
});

test('silence scores at most 2 %', () => {
  const { duration } = song();
  assert.ok(scoreAudio(new Float32Array(Math.ceil(duration * SAMPLE_RATE)), 'easy') <= 2);
});

test('white noise scores at most 2 %', () => {
  const { duration } = song();
  for (const amplitude of [0.02, 0.3]) {
    const percent = scoreAudio(whiteNoise(duration, amplitude), 'easy');
    assert.ok(percent <= 2, `amplitude ${amplitude}: ${percent}`);
  }
});

for (const difficulty of ['easy', 'medium', 'hard']) {
  test(`${difficulty}: a tone following the notes scores at least 95 %`, () => {
    const { notes, duration } = song();
    const percent = scoreAudio(synthesize(duration, melodyAt(notes)), difficulty);
    assert.ok(percent >= 95, `${percent}`);
  });

  test(`${difficulty}: the same tone an octave lower scores at least 95 %`, () => {
    const { notes, duration } = song();
    const percent = scoreAudio(synthesize(duration, melodyAt(notes, -12)), difficulty);
    assert.ok(percent >= 95, `${percent}`);
  });
}

test('medium: a tone 3 semitones off scores at most 10 %', () => {
  const { notes, duration } = song();
  const percent = scoreAudio(synthesize(duration, melodyAt(notes, 3)), 'medium');
  assert.ok(percent <= 10, `${percent}`);
});

test('hard: a steady hum scores at most 30 %', () => {
  const { duration } = song();
  const percent = scoreAudio(
    synthesize(duration, () => 60),
    'hard',
  );
  assert.ok(percent <= 30, `${percent}`);
});

test('the same audio gives the same score', () => {
  const { notes, duration } = song();
  const audio = synthesize(duration, melodyAt(notes, 1));
  assert.equal(scoreAudio(audio, 'medium'), scoreAudio(audio, 'medium'));
});
