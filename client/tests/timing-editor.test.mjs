// Checks for the timing editor's document model (spec FR-8).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addWordAfter,
  commit,
  deleteWord,
  docFromSegments,
  mergeLineWithNext,
  mergeWithNext,
  newHistory,
  nextWordRef,
  redo,
  segmentsFromDoc,
  setWordText,
  setWordTimes,
  shiftAllBy,
  shiftLineBy,
  shiftWordBy,
  splitLine,
  splitWord,
  tapEnd,
  tapWord,
  toggleNoSing,
  undo,
  validateDoc,
} from '../src/features/timing-editor/lib/model.ts';

const doc = () =>
  docFromSegments([
    {
      words: [
        { word: 'Ночь', start: 1, end: 1.4 },
        { word: 'пройдёт', start: 1.5, end: 2.1 },
        { word: 'и', start: 2.2, end: 2.3 },
      ],
    },
    {
      words: [
        { word: 'ты', start: 4, end: 4.2 },
        { word: 'останешься', start: 4.3, end: 5.2 },
      ],
    },
  ]);

const at = (d, line, word) => d.lines[line].words[word];

test('editing text and times does not touch the original document', () => {
  const original = doc();
  const edited = setWordTimes(
    setWordText(original, { line: 0, word: 0 }, 'День'),
    { line: 0, word: 0 },
    0.9,
    1.3,
  );
  assert.equal(at(original, 0, 0).text, 'Ночь');
  const { text, start, end } = at(edited, 0, 0);
  assert.deepEqual({ text, start, end }, { text: 'День', start: 0.9, end: 1.3 });
});

test('a word cannot become shorter than the minimum or start before zero', () => {
  const edited = setWordTimes(doc(), { line: 0, word: 0 }, -2, -1);
  assert.equal(at(edited, 0, 0).start, 0);
  assert.ok(at(edited, 0, 0).end >= 0.05);
});

test('shifts move a word, a line or the whole song', () => {
  assert.equal(at(shiftWordBy(doc(), { line: 0, word: 1 }, 0.2), 0, 1).start, 1.7);
  const line = shiftLineBy(doc(), 1, -0.5);
  assert.equal(at(line, 1, 0).start, 3.5);
  assert.equal(at(line, 0, 0).start, 1);
  const all = shiftAllBy(doc(), 1);
  assert.equal(at(all, 0, 0).start, 2);
  assert.equal(at(all, 1, 1).end, 6.2);
  // A shift stopped at zero keeps the word's length.
  const early = shiftWordBy(doc(), { line: 0, word: 0 }, -5);
  assert.equal(at(early, 0, 0).start, 0);
  assert.equal(at(early, 0, 0).end, 0.4);
});

test('split and merge of words are inverse on the text', () => {
  const split = splitWord(doc(), { line: 1, word: 1 }, 5);
  assert.equal(split.lines[1].words.length, 3);
  assert.equal(at(split, 1, 1).text, 'остан');
  assert.equal(at(split, 1, 2).text, 'ешься');
  assert.equal(at(split, 1, 1).end, at(split, 1, 2).start);
  const merged = mergeWithNext(doc(), { line: 0, word: 0 });
  assert.equal(at(merged, 0, 0).text, 'Ночь пройдёт');
  assert.equal(at(merged, 0, 0).end, 2.1);
  assert.equal(merged.lines[0].words.length, 2);
});

test('words and lines keep their ids; new ones get fresh ids', () => {
  const original = doc();
  const ids = original.lines.flatMap((line) => [line.id, ...line.words.map((w) => w.id)]);
  assert.equal(new Set(ids).size, ids.length);
  const moved = shiftWordBy(original, { line: 0, word: 1 }, 0.3);
  assert.equal(at(moved, 0, 1).id, at(original, 0, 1).id);
  const split = splitLine(splitWord(original, { line: 1, word: 1 }, 5), { line: 0, word: 2 });
  const after = split.lines.flatMap((line) => [line.id, ...line.words.map((w) => w.id)]);
  assert.equal(new Set(after).size, after.length);
  assert.equal(at(split, 0, 0).id, at(original, 0, 0).id);
});

test('split and merge of lines', () => {
  const split = splitLine(doc(), { line: 0, word: 2 });
  assert.equal(split.lines.length, 3);
  assert.equal(split.lines[1].words[0].text, 'и');
  const merged = mergeLineWithNext(doc(), 0);
  assert.equal(merged.lines.length, 1);
  assert.equal(merged.lines[0].words.length, 5);
});

test('adding and deleting words; an emptied line disappears', () => {
  const added = addWordAfter(doc(), { line: 0, word: 2 }, 'снова');
  assert.equal(at(added, 0, 3).text, 'снова');
  assert.equal(at(added, 0, 3).start, 2.3);
  let d = deleteWord(doc(), { line: 1, word: 0 });
  assert.equal(d.lines[1].words.length, 1);
  d = deleteWord(d, { line: 1, word: 0 });
  assert.equal(d.lines.length, 1);
});

test('the no-sing mark toggles and is saved', () => {
  const marked = toggleNoSing(doc(), { line: 0, word: 2 });
  assert.equal(at(marked, 0, 2).noSing, true);
  assert.equal(segmentsFromDoc(marked)[0].words[2].no_sing, true);
  assert.equal(at(toggleNoSing(marked, { line: 0, word: 2 }), 0, 2).noSing, undefined);
});

test('tap timing: each tap starts a word and ends the previous one', () => {
  let d = doc();
  let ref = { line: 0, word: 0 };
  for (const time of [10, 10.6, 11.4]) {
    d = tapWord(d, ref, time);
    ref = nextWordRef(d, ref);
  }
  d = tapEnd(d, { line: 0, word: 2 }, 11.9);
  assert.deepEqual(
    d.lines[0].words.map((w) => [w.start, w.end]),
    [
      [10, 10.6],
      [10.6, 11.4],
      [11.4, 11.9],
    ],
  );
  assert.deepEqual(ref, { line: 1, word: 0 });
  assert.equal(validateDoc(d).length, 0);
});

test('validation reports overlaps and empty words', () => {
  const overlapping = setWordTimes(doc(), { line: 0, word: 0 }, 1, 1.9);
  assert.deepEqual(validateDoc(overlapping), [{ ref: { line: 0, word: 0 }, problem: 'overlap' }]);
  const empty = setWordText(doc(), { line: 1, word: 0 }, '  ');
  assert.equal(validateDoc(empty)[0].problem, 'empty');
  assert.equal(segmentsFromDoc(empty)[1].words.length, 1);
});

test('saved segments carry text and bounds, in time order', () => {
  const saved = segmentsFromDoc(shiftLineBy(doc(), 0, 10));
  assert.equal(saved[0].text, 'ты останешься');
  assert.equal(saved[1].text, 'Ночь пройдёт и');
  assert.equal(saved[1].start, 11);
  assert.equal(saved[1].end, 12.3);
});

test('50 edits undo and redo back to the same documents', () => {
  const start = doc();
  let history = newHistory(start);
  const edits = [
    (d, i) => shiftWordBy(d, { line: 0, word: i % 3 }, 0.01),
    (d, i) => setWordText(d, { line: 1, word: 0 }, `ты${i}`),
    (d) => shiftAllBy(d, 0.02),
    (d) => toggleNoSing(d, { line: 0, word: 1 }),
    (d, i) => setWordTimes(d, { line: 1, word: 1 }, 4.3 + i * 0.001, 5.2),
  ];
  for (let i = 0; i < 50; i++) {
    history = commit(history, edits[i % edits.length](history.present, i));
  }
  const final = history.present;
  assert.equal(history.past.length, 50);

  for (let i = 0; i < 50; i++) {
    history = undo(history);
  }
  assert.deepEqual(history.present, start);
  assert.equal(undo(history), history);

  for (let i = 0; i < 50; i++) {
    history = redo(history);
  }
  assert.deepEqual(history.present, final);
  assert.equal(redo(history), history);

  // A new edit after undo drops the redo branch.
  history = commit(undo(history), shiftAllBy(undo(history).present, 1));
  assert.equal(history.future.length, 0);
});
