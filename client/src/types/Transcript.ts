export type NoteType = "normal" | "golden" | "rap" | "free";

export type Note = {
  start: number;
  end: number;
  /** MIDI note number; `null` for a note without pitch (rap). */
  pitch: number | null;
  type: NoteType;
};

/** Lowest and highest sung note of the song, as MIDI note numbers. */
export type PitchRange = {
  low: number;
  high: number;
};

export type Word = {
  word: string;
  start: number;
  end: number;
  score?: number;
  estimated?: boolean;
  reading?: string;
  /** Syllable of a longer word: the next token continues it without a space. */
  joined?: boolean;
  /** Present from transcript version 2. */
  notes?: Note[];
  /** UltraStar files: one note per syllable, in semitones from C4. */
  pitch?: number;
};

export type Segment = {
  text: string;
  start: number;
  end: number;
  words: Word[];
};

export type Transcript = {
  language: string;
  segments: Segment[];
  source?: string;
  version?: number;
  range?: PitchRange | null;
  /** From transcript version 3; see `transcript-quality.ts`. */
  quality?: { uncovered_voice: number | null };
  /** Total per-song shift of the lyrics against the audio, already applied. */
  lyrics_offset_ms?: number;
};

export type AudioPaths = {
  instrumental: string;
  vocals: string | null;
};
