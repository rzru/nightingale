/**
 * Reference notes prepared for the pitch graph: the vertical range of the plot
 * is fitted to the song, and the voice line follows the octave of the nearby
 * note. Pure module, shared by the app and the Node tests.
 */

import { foldedDistance, type ScoreNote, type ScoreNoteType } from './note-scoring';

export type DisplayNote = {
  start: number;
  end: number;
  /** Semitone to draw at; `null` for notes without pitch. */
  semitone: number | null;
  /** Pitch as written in the transcript, before the display shift. */
  pitch: number | null;
  type: ScoreNoteType;
};

export type NoteView = {
  notes: DisplayNote[];
  /** Lowest semitone of the plot and its height in semitones. */
  lowest: number;
  range: number;
  /** Where a voice with no note to follow is anchored. */
  centre: number;
};

export type VoiceHint = {
  /** The voice should go up (1), down (-1) or is on the note (0). */
  direction: -1 | 0 | 1;
  /** Octaves between the voice and the written note; 0 when in the same one. */
  octaves: number;
};

const VIEW_MARGIN = 3;
const MIN_VIEW_RANGE = 14;
/** How far from a note the voice line still follows that note's octave. */
const NEAR_NOTE_SEC = 1.5;

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Fit the plot to the notes; `null` when no note has a pitch. */
export function buildNoteView(notes: readonly ScoreNote[]): NoteView | null {
  const pitches = notes.flatMap((note) => (note.pitch === null ? [] : [note.pitch]));
  if (pitches.length === 0) {
    return null;
  }

  const low = Math.min(...pitches);
  const high = Math.max(...pitches);
  const range = Math.max(MIN_VIEW_RANGE, high - low + 2 * VIEW_MARGIN);
  const lowest = (low + high) / 2 - range / 2;

  return {
    notes: notes.map((note) => ({
      start: note.start,
      end: note.end,
      semitone: note.pitch,
      pitch: note.pitch,
      type: note.type,
    })),
    lowest,
    range,
    centre: median(pitches),
  };
}

/** The note sounding at `time`, or the closest one within `NEAR_NOTE_SEC`. */
export function noteNear(view: NoteView, time: number): DisplayNote | null {
  let best: DisplayNote | null = null;
  let bestGap = NEAR_NOTE_SEC;
  for (const note of view.notes) {
    if (note.semitone === null) {
      continue;
    }
    if (time >= note.start && time < note.end) {
      return note;
    }
    const gap = time < note.start ? note.start - time : time - note.end;
    if (gap < bestGap) {
      best = note;
      bestGap = gap;
    }
    if (note.start - time > NEAR_NOTE_SEC) {
      break;
    }
  }
  return best;
}

/** Semitone the voice line follows at `time`: octave of the nearby note. */
export function voiceAnchor(view: NoteView, time: number): number {
  return noteNear(view, time)?.semitone ?? view.centre;
}

/** The pitched note sounding exactly at `time`. */
export function activeNote(view: NoteView, time: number): DisplayNote | null {
  return (
    view.notes.find((note) => note.pitch !== null && time >= note.start && time < note.end) ?? null
  );
}

/**
 * Which way the singer should move to reach the note, and how many octaves
 * away from the written note they sing. `tolerance` is in semitones.
 */
export function voiceHint(note: DisplayNote, userSemitone: number, tolerance: number): VoiceHint {
  if (note.pitch === null) {
    return { direction: 0, octaves: 0 };
  }
  // `+ 0` turns the -0 that rounding small negatives gives into 0.
  const octaves = Math.round((userSemitone - note.pitch) / 12) + 0;
  const offset = userSemitone - octaves * 12 - note.pitch;
  if (foldedDistance(note.pitch, userSemitone) <= tolerance) {
    return { direction: 0, octaves };
  }
  return { direction: offset < 0 ? 1 : -1, octaves };
}
