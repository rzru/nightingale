/**
 * Note-based scoring (transcript version 2).
 *
 * A frame of singing counts when the voice is within the difficulty tolerance
 * of the note, ignoring the octave. A note's accuracy is the share of its
 * duration that counted. The final score is 9000 points for notes (weighted by
 * duration and note type) plus 1000 points for lines sung at 80 % or better.
 *
 * This module has no imports on purpose: it runs unchanged in the app and in
 * the Node test runner.
 */

export type Difficulty = 'easy' | 'medium' | 'hard';

export type ScoreNoteType = 'normal' | 'golden' | 'rap' | 'free';

export type ScoreNote = {
  start: number;
  end: number;
  /** MIDI note number; `null` for a note without pitch. */
  pitch: number | null;
  type: ScoreNoteType;
  /** Index of the lyric line the note belongs to. */
  line: number;
};

export type LineResult = {
  line: number;
  /** 0..1, weighted by note duration and type. */
  accuracy: number;
  /** The playhead has passed the last note of the line. */
  finished: boolean;
};

export type ScoreSummary = {
  /** 0..10000. */
  score: number;
  notePoints: number;
  lineBonus: number;
  /** 0..1 over the notes finished so far. */
  accuracy: number;
  combo: number;
  maxCombo: number;
};

export const SCORING_VERSION = 2;
export const MAX_SCORE = 10_000;
export const NOTE_POINTS = 9000;
export const LINE_BONUS_POINTS = 1000;
export const LINE_BONUS_ACCURACY = 0.8;
export const COMBO_ACCURACY = 0.5;
export const DEFAULT_DIFFICULTY: Difficulty = 'easy';

/** Allowed distance from the note centre, in semitones. */
export const DIFFICULTY_TOLERANCE: Record<Difficulty, number> = {
  easy: 2,
  medium: 1,
  hard: 0.5,
};

const NOTE_TYPE_WEIGHT: Record<ScoreNoteType, number> = {
  golden: 2,
  normal: 1,
  rap: 0.5,
  free: 0,
};

/** Voice-line colouring levels; the graph maps 1 to green, 0.7 to yellow, low to red. */
export const QUALITY_HIT = 1;
export const QUALITY_NEAR = 0.7;
export const QUALITY_MISS = 0.3;

/** Longest gap between two updates that is still scored as continuous singing. */
const MAX_FRAME_SEC = 0.1;

type TranscriptNoteLike = {
  start: number;
  end: number;
  pitch: number | null;
  type?: string;
};

type TranscriptWordLike = {
  start: number;
  end: number;
  notes?: TranscriptNoteLike[];
  /** UltraStar files: one note per syllable, in semitones from C4. */
  pitch?: number;
};

type TranscriptSegmentLike = {
  words: TranscriptWordLike[];
};

const USDX_PITCH_BASE = 60;

const wordNotes = (word: TranscriptWordLike): TranscriptNoteLike[] => {
  if (word.notes !== undefined) {
    return word.notes;
  }
  return typeof word.pitch === 'number'
    ? [{ start: word.start, end: word.end, pitch: USDX_PITCH_BASE + word.pitch }]
    : [];
};

const noteType = (note: TranscriptNoteLike): ScoreNoteType => {
  if (note.type === 'free') {
    return 'free';
  }
  if (note.pitch === null || note.type === 'rap') {
    return 'rap';
  }
  return note.type === 'golden' ? 'golden' : 'normal';
};

/** Flatten transcript segments into scoring notes; one segment is one line. */
export function scoreNotesFromSegments(segments: readonly TranscriptSegmentLike[]): ScoreNote[] {
  const notes: ScoreNote[] = [];
  segments.forEach((segment, line) => {
    for (const word of segment.words) {
      for (const note of wordNotes(word)) {
        if (note.end > note.start) {
          notes.push({
            start: note.start,
            end: note.end,
            pitch: note.pitch,
            type: noteType(note),
            line,
          });
        }
      }
    }
  });
  return notes.toSorted((a, b) => a.start - b.start);
}

/** Distance between two pitches in semitones, ignoring the octave (0..6). */
export function foldedDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 12;
  return diff > 6 ? 12 - diff : diff;
}

export function frameCounts(
  note: Pick<ScoreNote, 'pitch' | 'type'>,
  userSemitone: number | null,
  tolerance: number,
): boolean {
  if (userSemitone === null || note.type === 'free') {
    return false;
  }
  if (note.pitch === null) {
    return true;
  }
  return foldedDistance(note.pitch, userSemitone) <= tolerance;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export class NoteScoring {
  private readonly notes: ScoreNote[];
  private readonly weights: number[];
  private readonly hit: number[];
  private readonly tolerance: number;
  private readonly totalWeight: number;
  private lastTime = 0;
  /** First note that may still overlap the playhead. */
  private cursor = 0;

  constructor(notes: readonly ScoreNote[], difficulty: Difficulty = DEFAULT_DIFFICULTY) {
    this.notes = notes.toSorted((a, b) => a.start - b.start);
    this.weights = this.notes.map((note) => (note.end - note.start) * NOTE_TYPE_WEIGHT[note.type]);
    this.hit = this.notes.map(() => 0);
    this.tolerance = DIFFICULTY_TOLERANCE[difficulty];
    this.totalWeight = this.weights.reduce((sum, weight) => sum + weight, 0);
  }

  get hasNotes(): boolean {
    return this.totalWeight > 0;
  }

  /** Seeking back un-scores everything after the new position. */
  private rewind(time: number): void {
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const note = this.notes[i];
      if (note.end <= time) {
        continue;
      }
      if (note.start >= time) {
        this.hit[i] = 0;
      } else {
        const sungUntil = Math.min(this.lastTime, note.end);
        const kept = sungUntil > note.start ? (time - note.start) / (sungUntil - note.start) : 0;
        this.hit[i] *= clamp01(kept);
      }
    }
    this.cursor = 0;
    this.lastTime = time;
  }

  /**
   * Score the time since the previous call.
   * `userSemitone` is the singer's pitch as a fractional MIDI number, or
   * `null` when no voice is detected.
   */
  accumulate(time: number, userSemitone: number | null): void {
    if (time < this.lastTime) {
      this.rewind(time);
    }
    const from = Math.max(this.lastTime, time - MAX_FRAME_SEC);
    this.lastTime = time;
    if (time <= from) {
      return;
    }

    while (this.cursor < this.notes.length && this.notes[this.cursor].end <= from) {
      this.cursor += 1;
    }
    for (let i = this.cursor; i < this.notes.length; i++) {
      const note = this.notes[i];
      if (note.start >= time) {
        break;
      }
      const overlap = Math.min(time, note.end) - Math.max(from, note.start);
      if (overlap > 0 && frameCounts(note, userSemitone, this.tolerance)) {
        this.hit[i] = Math.min(note.end - note.start, this.hit[i] + overlap);
      }
    }
  }

  /**
   * How the voice fits the note due at `time`, for colouring the voice line:
   * `QUALITY_HIT` inside the tolerance, `QUALITY_NEAR` within twice the
   * tolerance, `QUALITY_MISS` further away, 0 when no note is due or there is
   * no voice.
   */
  frameQuality(time: number, userSemitone: number | null): number {
    if (userSemitone === null) {
      return 0;
    }
    const note = this.notes.find(
      (candidate) => candidate.type !== 'free' && time >= candidate.start && time < candidate.end,
    );
    if (note === undefined) {
      return 0;
    }
    if (note.pitch === null) {
      return QUALITY_HIT;
    }
    const distance = foldedDistance(note.pitch, userSemitone);
    if (distance <= this.tolerance) {
      return QUALITY_HIT;
    }
    return distance <= 2 * this.tolerance ? QUALITY_NEAR : QUALITY_MISS;
  }

  private noteAccuracy(index: number): number {
    const note = this.notes[index];
    return clamp01(this.hit[index] / (note.end - note.start));
  }

  lineResults(): LineResult[] {
    const lines = new Map<number, { weight: number; earned: number; end: number }>();
    this.notes.forEach((note, i) => {
      const weight = this.weights[i];
      if (weight <= 0) {
        return;
      }
      const line = lines.get(note.line) ?? { weight: 0, earned: 0, end: 0 };
      line.weight += weight;
      line.earned += weight * this.noteAccuracy(i);
      line.end = Math.max(line.end, note.end);
      lines.set(note.line, line);
    });
    return [...lines.entries()]
      .toSorted(([a], [b]) => a - b)
      .map(([line, value]) => ({
        line,
        accuracy: value.earned / value.weight,
        finished: value.end <= this.lastTime,
      }));
  }

  summary(): ScoreSummary {
    if (!this.hasNotes) {
      return { score: 0, notePoints: 0, lineBonus: 0, accuracy: 0, combo: 0, maxCombo: 0 };
    }

    let earned = 0;
    let finishedWeight = 0;
    let finishedEarned = 0;
    let combo = 0;
    let maxCombo = 0;
    this.notes.forEach((note, i) => {
      const weight = this.weights[i];
      if (weight <= 0) {
        return;
      }
      const accuracy = this.noteAccuracy(i);
      earned += weight * accuracy;
      if (note.end > this.lastTime) {
        return;
      }
      finishedWeight += weight;
      finishedEarned += weight * accuracy;
      combo = accuracy >= COMBO_ACCURACY ? combo + 1 : 0;
      maxCombo = Math.max(maxCombo, combo);
    });

    const lines = this.lineResults();
    const goodLines = lines.filter(
      (line) => line.finished && line.accuracy >= LINE_BONUS_ACCURACY,
    ).length;
    const notePoints = (NOTE_POINTS * earned) / this.totalWeight;
    const lineBonus = lines.length > 0 ? (LINE_BONUS_POINTS * goodLines) / lines.length : 0;

    return {
      score: Math.round(Math.min(MAX_SCORE, notePoints + lineBonus)),
      notePoints,
      lineBonus,
      accuracy: finishedWeight > 0 ? finishedEarned / finishedWeight : 0,
      combo,
      maxCombo,
    };
  }
}
