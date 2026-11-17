import type { PitchRange } from '@/types/Transcript';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Scientific pitch notation: MIDI 60 is C4, 69 is A4. */
export const midiNoteName = (midi: number): string => {
  const rounded = Math.round(midi);
  return `${NOTE_NAMES[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
};

export const formatPitchRange = (range: PitchRange | null, semitones = 0): string | null =>
  range === null
    ? null
    : `${midiNoteName(range.low + semitones)} – ${midiNoteName(range.high + semitones)}`;
