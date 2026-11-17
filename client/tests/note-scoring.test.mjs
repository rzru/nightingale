// Run with: node --test tests/
// Acceptance checks for note-based scoring (spec FR-7). The singer's pitch is
// fed as MIDI numbers, so these cover the scoring rules, not pitch detection.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_SCORE,
  NoteScoring,
  scoreNotesFromSegments,
} from '../src/features/playback/lib/scoring/note-scoring.ts';

const STEP = 0.02;
const MELODY = [60, 62, 64, 65, 67, 65, 64, 62, 60, 64, 67, 72, 71, 67, 64, 62];

/** 6 lines of 8 notes: 0.4 s notes, 0.1 s gaps, 1 s between lines. */
function song() {
  const segments = [];
  let t = 1;
  for (let line = 0; line < 6; line++) {
    const words = [];
    for (let i = 0; i < 8; i++) {
      const pitch = MELODY[(line * 3 + i) % MELODY.length];
      words.push({ notes: [{ start: t, end: t + 0.4, pitch, type: 'normal' }] });
      t += 0.5;
    }
    segments.push({ words });
    t += 1;
  }
  return { notes: scoreNotesFromSegments(segments), duration: t };
}

function pitchAt(notes, time) {
  const note = notes.find((n) => time > n.start && time <= n.end);
  return note ? note.pitch : null;
}

/** Sing the whole song; `voice(time)` returns a MIDI pitch or null. */
function sing(voice, difficulty, { from = 0, scoring } = {}) {
  const { notes, duration } = song();
  const s = scoring ?? new NoteScoring(notes, difficulty);
  for (let t = from; t <= duration; t += STEP) {
    s.accumulate(t, voice(t, notes));
  }
  return s;
}

const exact = (t, notes) => pitchAt(notes, t);
const percent = (s) => (100 * s.summary().score) / MAX_SCORE;

for (const difficulty of ['easy', 'medium', 'hard']) {
  test(`${difficulty}: silence scores nothing`, () => {
    assert.equal(sing(() => null, difficulty).summary().score, 0);
  });

  test(`${difficulty}: exact singing scores at least 95 %`, () => {
    const s = sing(exact, difficulty);
    assert.ok(percent(s) >= 95, `${percent(s)}`);
    assert.equal(s.summary().maxCombo, 48);
  });

  test(`${difficulty}: an octave lower scores at least 95 %`, () => {
    const s = sing((t, notes) => {
      const p = pitchAt(notes, t);
      return p === null ? null : p - 12;
    }, difficulty);
    assert.ok(percent(s) >= 95, `${percent(s)}`);
  });
}

test('medium: 3 semitones off scores at most 10 %', () => {
  const s = sing((t, notes) => {
    const p = pitchAt(notes, t);
    return p === null ? null : p + 3;
  }, 'medium');
  assert.ok(percent(s) <= 10, `${percent(s)}`);
});

test('hard: humming one note scores at most 30 %', () => {
  const s = sing(() => 64, 'hard');
  assert.ok(percent(s) <= 30, `${percent(s)}`);
});

// Decision (spec 1.3): the hum limit applies to hard only. With octaves
// ignored, the easy and medium windows are wide on purpose.
test('easy and medium: humming one note stays well below a real performance', () => {
  assert.ok(percent(sing(() => 64, 'medium')) <= 40);
  assert.ok(percent(sing(() => 64, 'easy')) <= 60);
});

test('the same input gives the same score', () => {
  const voice = (t, notes) => {
    const p = pitchAt(notes, t);
    return p === null ? null : p + Math.sin(t * 7) * 1.5;
  };
  assert.deepEqual(sing(voice, 'medium').summary(), sing(voice, 'medium').summary());
});

test('singing in the gaps between notes changes nothing', () => {
  // 69 is at least 2 semitones from every note of the melody.
  const always = (t, notes) => pitchAt(notes, t) ?? 69;
  assert.equal(sing(always, 'hard').summary().score, sing(exact, 'hard').summary().score);
});

test('late entry lowers the note accuracy', () => {
  const late = (t, notes) => {
    const note = notes.find((n) => t > n.start + 0.2 && t <= n.end);
    return note ? note.pitch : null;
  };
  const p = percent(sing(late, 'easy'));
  assert.ok(p > 35 && p < 55, `${p}`);
});

test('rewinding re-scores the repeated part once', () => {
  const { notes } = song();
  const s = new NoteScoring(notes, 'easy');
  // First pass: the first two lines sung wrong.
  for (let t = 0; t <= 10; t += STEP) {
    s.accumulate(t, null);
  }
  // Seek to the start and sing everything right.
  sing(exact, 'easy', { scoring: s });
  assert.equal(s.summary().score, sing(exact, 'easy').summary().score);

  // Singing a part right twice never exceeds the maximum.
  sing(exact, 'easy', { scoring: s });
  assert.ok(s.summary().score <= MAX_SCORE);
  assert.equal(s.summary().score, sing(exact, 'easy').summary().score);
});

test('line bonus needs 80 % of the line', () => {
  // Only the first line is sung.
  const s = sing((t, notes) => (t < 5.5 ? pitchAt(notes, t) : null), 'easy');
  const lines = s.lineResults();
  assert.equal(lines.length, 6);
  assert.ok(lines[0].accuracy >= 0.95);
  assert.equal(lines[1].accuracy, 0);
  const { lineBonus, notePoints } = s.summary();
  assert.ok(Math.abs(lineBonus - 1000 / 6) < 1e-6);
  assert.ok(Math.abs(notePoints - 9000 / 6) < 9000 * 0.01);
});

test('rap notes count any voice, free notes count nothing', () => {
  const notes = scoreNotesFromSegments([
    {
      words: [
        { notes: [{ start: 1, end: 2, pitch: null, type: 'rap' }] },
        { notes: [{ start: 2, end: 3, pitch: 60, type: 'free' }] },
      ],
    },
  ]);
  const s = new NoteScoring(notes, 'hard');
  for (let t = 0; t <= 4; t += STEP) {
    s.accumulate(t, 47.3);
  }
  assert.ok(s.summary().score >= 0.95 * MAX_SCORE);
});

test('report: scores of careless input per difficulty', () => {
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return 48 + (seed / 2147483648) * 24;
  };
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const hum = percent(sing(() => 64, difficulty)).toFixed(1);
    seed = 12345;
    const noise = percent(sing(() => random(), difficulty)).toFixed(1);
    const off3 = percent(
      sing((t, notes) => {
        const p = pitchAt(notes, t);
        return p === null ? null : p + 3;
      }, difficulty),
    ).toFixed(1);
    console.log(`REPORT ${difficulty}: hum=${hum}% random_pitch=${noise}% off_by_3=${off3}%`);
  }
});

test('voice line colour follows the scoring rule', () => {
  const notes = scoreNotesFromSegments([
    { words: [{ notes: [{ start: 1, end: 2, pitch: 60, type: 'normal' }] }] },
  ]);
  const s = new NoteScoring(notes, 'medium');
  assert.equal(s.frameQuality(1.5, 60.9), 1);
  assert.equal(s.frameQuality(1.5, 48), 1);
  assert.equal(s.frameQuality(1.5, 61.5), 0.7);
  assert.equal(s.frameQuality(1.5, 64), 0.3);
  assert.equal(s.frameQuality(1.5, null), 0);
  assert.equal(s.frameQuality(2.5, 60), 0);
});
