// Checks for the reference notes shown on the pitch graph (spec FR-6).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  activeNote,
  buildNoteView,
  voiceAnchor,
  voiceHint,
} from '../src/features/playback/lib/scoring/note-display.ts';

const note = (start, end, pitch, type = 'normal') => ({ start, end, pitch, type, line: 0 });
const NOTES = [note(1, 2, 60), note(2, 3, 64), note(3, 3.5, null, 'rap'), note(10, 11, 72)];

test('the plot is fitted to the song with a margin', () => {
  const view = buildNoteView(NOTES);
  assert.ok(view.lowest <= 60 - 3);
  assert.ok(view.lowest + view.range >= 72 + 3);
  assert.equal(view.notes.length, 4);
});

test('a narrow melody still gets a readable range', () => {
  const view = buildNoteView([note(1, 2, 60), note(2, 3, 61)]);
  assert.ok(view.range >= 14);
});

test('songs without pitched notes have no note view', () => {
  assert.equal(buildNoteView([note(1, 2, null, 'rap')]), null);
});

test('the voice line follows the nearby note and falls back to the centre', () => {
  const view = buildNoteView(NOTES);
  assert.equal(voiceAnchor(view, 1.5), 60);
  assert.equal(voiceAnchor(view, 2.5), 64);
  // Just before a note: already follow it.
  assert.equal(voiceAnchor(view, 9.2), 72);
  // Far from any note.
  assert.equal(voiceAnchor(view, 6), view.centre);
});

test('only a pitched note sounding now is active', () => {
  const view = buildNoteView(NOTES);
  assert.equal(activeNote(view, 1.5).pitch, 60);
  assert.equal(activeNote(view, 3.2), null);
  assert.equal(activeNote(view, 5), null);
});

test('hints say which way to move and mark another octave', () => {
  const view = buildNoteView(NOTES);
  const target = activeNote(view, 1.5);
  assert.deepEqual(voiceHint(target, 60.4, 1), { direction: 0, octaves: 0 });
  assert.deepEqual(voiceHint(target, 57, 1), { direction: 1, octaves: 0 });
  assert.deepEqual(voiceHint(target, 63, 1), { direction: -1, octaves: 0 });
  // An octave lower and in tune: no arrow, octave mark.
  assert.deepEqual(voiceHint(target, 48.2, 1), { direction: 0, octaves: -1 });
  // An octave lower and flat: go up.
  assert.deepEqual(voiceHint(target, 45, 1), { direction: 1, octaves: -1 });
});
