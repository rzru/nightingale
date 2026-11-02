import {
  PITCH_BUFFER_SIZE,
  PITCH_WINDOW_SAMPLES,
  PUSH_INTERVAL_SEC,
  SEMITONE_TOLERANCE,
  SMOOTHING,
} from './constants';
import { createPitchDetector, detectPitchFromSamples } from './detect';

export type ReferencePitchTrack = {
  pitches: (number | null)[];
  intervalSec: number;
  singableTime: number;
};

export type PitchSeries = {
  refPitches: (number | null)[];
  userPitches: (number | null)[];
  displaySemitones: (number | null)[];
  similarities: number[];
  times: number[];
  referenceTrack: ReferencePitchTrack | null;
  referenceTime: number;
  currentTime: number;
};

export function freqToSemitone(hz: number): number {
  return 12 * Math.log2(hz / 440) + 69;
}

export function pitchSimilarity(refHz: number, userHz: number): number {
  const refSemi = freqToSemitone(refHz);
  const userSemi = freqToSemitone(userHz);
  let diff = Math.abs(refSemi - userSemi) % 12;
  if (diff > 6) {
    diff = 12 - diff;
  }
  return Math.max(0, 1 - diff / SEMITONE_TOLERANCE);
}

function ema(prev: number | null | undefined, current: number | null | undefined): number | null {
  if (current === null || current === undefined) {
    return null;
  }
  if (prev === null || prev === undefined) {
    return current;
  }
  return prev * SMOOTHING + current * (1 - SMOOTHING);
}

export function snapToRefOctave(refSemi: number, userSemi: number): number {
  const d = userSemi - refSemi;
  const octaveOffset = Math.round(d / 12) * 12;
  return userSemi - octaveOffset;
}

const DISPLAY_OCTAVE_STABILITY_SEC = 0.1;
const OCTAVE_BOUNDARY_SEMITONES = 6;

export class PitchStateBuffer {
  refPitches: (number | null)[] = [];
  userPitches: (number | null)[] = [];
  displaySemitones: (number | null)[] = [];
  similarities: number[] = [];
  private smoothedRef: number | null = null;
  private smoothedUser: number | null = null;
  private times: number[] = [];
  private octaveOffsets: number[] = [];
  private displayOctaveOffset = 0;
  private pendingOctaveOffset: number | null = null;
  private pendingOctaveSince = 0;
  private lastDisplaySemitone: number | null = null;
  private lastPushTime = 0;

  private normalizeDisplayPitch(time: number): number | null {
    if (this.smoothedUser === null) {
      return null;
    }

    const userSemitone = freqToSemitone(this.smoothedUser);
    if (this.smoothedRef !== null) {
      const desiredOffset =
        userSemitone - snapToRefOctave(freqToSemitone(this.smoothedRef), userSemitone);
      if (desiredOffset === this.displayOctaveOffset) {
        this.pendingOctaveOffset = null;
      } else if (desiredOffset !== this.pendingOctaveOffset) {
        this.pendingOctaveOffset = desiredOffset;
        this.pendingOctaveSince = time;
      } else if (time - this.pendingOctaveSince >= DISPLAY_OCTAVE_STABILITY_SEC) {
        this.displayOctaveOffset = desiredOffset;
        this.pendingOctaveOffset = null;
      }
    } else {
      this.pendingOctaveOffset = null;
    }

    let displaySemitone = userSemitone - this.displayOctaveOffset;
    const preserveOctave = this.smoothedRef === null || this.pendingOctaveOffset !== null;
    if (
      preserveOctave &&
      this.lastDisplaySemitone !== null &&
      Math.abs(displaySemitone - this.lastDisplaySemitone) > OCTAVE_BOUNDARY_SEMITONES
    ) {
      displaySemitone = this.preserveDisplayOctave(displaySemitone);
    }

    this.lastDisplaySemitone = displaySemitone;
    return displaySemitone;
  }

  private preserveDisplayOctave(displaySemitone: number): number {
    const normalized = snapToRefOctave(
      this.lastDisplaySemitone ?? displaySemitone,
      displaySemitone,
    );
    if (this.smoothedRef === null) {
      this.displayOctaveOffset += displaySemitone - normalized;
    }
    return normalized;
  }

  private rewind(time: number): void {
    while (this.times.length > 0 && this.times[this.times.length - 1] > time) {
      this.times.pop();
      this.refPitches.pop();
      this.userPitches.pop();
      this.displaySemitones.pop();
      this.similarities.pop();
      this.octaveOffsets.pop();
    }
    this.smoothedRef = this.refPitches.at(-1) ?? null;
    this.smoothedUser = this.userPitches.at(-1) ?? null;
    this.displayOctaveOffset = this.octaveOffsets.at(-1) ?? 0;
    this.pendingOctaveOffset = null;
    this.lastDisplaySemitone = this.displaySemitones.at(-1) ?? null;
    this.lastPushTime = this.times.at(-1) ?? time - PUSH_INTERVAL_SEC;
  }

  tryPush(
    refPitch: number | null,
    userPitch: number | null,
    similarity: number,
    time: number,
  ): void {
    if (time < this.lastPushTime) {
      this.rewind(time);
    }

    this.smoothedRef = ema(this.smoothedRef, refPitch);
    this.smoothedUser = ema(this.smoothedUser, userPitch);

    if (time - this.lastPushTime < PUSH_INTERVAL_SEC) {
      return;
    }
    this.lastPushTime = time;

    const displaySemitone = this.normalizeDisplayPitch(time);

    if (this.refPitches.length >= PITCH_BUFFER_SIZE) {
      this.times.shift();
      this.refPitches.shift();
      this.userPitches.shift();
      this.displaySemitones.shift();
      this.similarities.shift();
      this.octaveOffsets.shift();
    }
    this.times.push(time);
    this.refPitches.push(this.smoothedRef);
    this.userPitches.push(this.smoothedUser);
    this.displaySemitones.push(displaySemitone);
    this.similarities.push(similarity);
    this.octaveOffsets.push(this.displayOctaveOffset);
  }

  snapshot(): PitchSeries {
    return {
      refPitches: [...this.refPitches],
      userPitches: [...this.userPitches],
      displaySemitones: [...this.displaySemitones],
      similarities: [...this.similarities],
      times: [...this.times],
      referenceTrack: null,
      referenceTime: this.times.at(-1) ?? 0,
      currentTime: this.times.at(-1) ?? 0,
    };
  }

  reset(): void {
    this.refPitches = [];
    this.userPitches = [];
    this.displaySemitones = [];
    this.similarities = [];
    this.times = [];
    this.octaveOffsets = [];
    this.smoothedRef = null;
    this.smoothedUser = null;
    this.displayOctaveOffset = 0;
    this.pendingOctaveOffset = null;
    this.pendingOctaveSince = 0;
    this.lastDisplaySemitone = null;
    this.lastPushTime = 0;
  }
}

export class PitchScoring {
  totalSingable: number;
  earned = 0;
  lastTime = 0;
  private readonly contributions: { start: number; end: number; earned: number }[] = [];

  constructor(totalSingable: number) {
    this.totalSingable = Math.max(0.5, totalSingable);
  }

  private rewind(currentTime: number): void {
    while (
      this.contributions.length > 0 &&
      this.contributions[this.contributions.length - 1].start >= currentTime
    ) {
      this.earned -= this.contributions.pop()?.earned ?? 0;
    }

    const contribution = this.contributions.at(-1);
    if (contribution && contribution.end > currentTime) {
      const kept =
        contribution.earned *
        ((currentTime - contribution.start) / (contribution.end - contribution.start));
      this.earned -= contribution.earned - kept;
      contribution.end = currentTime;
      contribution.earned = kept;
    }
    this.lastTime = currentTime;
  }

  accumulate(
    currentTime: number,
    refPitch: number | null,
    userPitch: number | null,
    similarity: number,
  ): void {
    if (currentTime < this.lastTime) {
      this.rewind(currentTime);
    }

    const dt = Math.min(0.1, Math.max(0, currentTime - this.lastTime));
    this.lastTime = currentTime;
    if (refPitch !== null && userPitch !== null && dt > 0) {
      const earned = similarity * dt;
      this.earned += earned;
      this.contributions.push({ start: currentTime - dt, end: currentTime, earned });
    }
  }

  score(): number {
    return Math.round(Math.min(1000, Math.max(0, (this.earned / this.totalSingable) * 1000)));
  }
}

export function analyzeReferencePitches(vocals: AudioBuffer): ReferencePitchTrack {
  const sr = vocals.sampleRate;
  const ch = vocals.numberOfChannels > 0 ? vocals.getChannelData(0) : null;
  const hop = PITCH_WINDOW_SAMPLES / 2;
  const intervalSec = hop / sr;
  if (ch === null) {
    return { pitches: [], intervalSec, singableTime: 0 };
  }

  const detector = createPitchDetector();
  const window = new Float32Array(PITCH_WINDOW_SAMPLES);
  const pitches: (number | null)[] = [];
  let singableTime = 0;

  for (let offset = 0; offset + PITCH_WINDOW_SAMPLES <= ch.length; offset += hop) {
    window.set(ch.subarray(offset, offset + PITCH_WINDOW_SAMPLES));
    const pitch = detectPitchFromSamples(detector, window, sr);
    pitches.push(pitch);
    if (pitch !== null) {
      singableTime += intervalSec;
    }
  }

  return { pitches, intervalSec, singableTime };
}

export function sampleVocalsWindow(
  vocals: AudioBuffer | null,
  timeSec: number,
  out: Float32Array,
  latencyCompensationSec: number,
): boolean {
  if (!vocals || out.length !== PITCH_WINDOW_SAMPLES) {
    return false;
  }
  const sr = vocals.sampleRate;
  const start = Math.floor(Math.max(0, timeSec - latencyCompensationSec) * sr);
  const ch = vocals.numberOfChannels > 0 ? vocals.getChannelData(0) : null;
  if (!ch || start + out.length > ch.length) {
    return false;
  }
  out.set(ch.subarray(start, start + out.length));
  return true;
}
