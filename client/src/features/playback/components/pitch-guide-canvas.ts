import type { PitchSeries, ReferencePitchTrack } from '@/features/playback/lib/pitch/state';
import { freqToSemitone, snapToRefOctave } from '@/features/playback/lib/pitch/state';
import type { Rgb } from '@/types/Rgb';

export type PitchGuideNote = {
  start: number;
  end: number;
  semitone: number;
};

export type PitchGuideTrack = {
  notes: PitchGuideNote[];
  lowestSemitone: number;
  highestSemitone: number;
};

export type PitchGuidePlayer = {
  series: PitchSeries;
  color: Rgb;
};

type GuideLayout = {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  playheadX: number;
  lowestSemitone: number;
  highestSemitone: number;
};

type RenderPitchGuideInput = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  track: PitchGuideTrack;
  series: PitchSeries;
  players: PitchGuidePlayer[];
};

type RenderPitchGuideLanesInput = Pick<
  RenderPitchGuideInput,
  'canvas' | 'width' | 'height' | 'track'
>;

const VIEW_SECONDS = 3.5;
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const TARGET_COLOR: Rgb = { r: 0.5, g: 0.72, b: 1 };
const SOLO_COLOR: Rgb = { r: 0.85, g: 0.85, b: 1 };
const MATCH_COLOR: Rgb = { r: 0.2, g: 0.9, b: 0.3 };

function rgba({ r, g, b }: Rgb, alpha: number): string {
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${alpha})`;
}

function stableSampleCount(seconds: number, interval: number): number {
  return Math.max(2, Math.ceil(seconds / interval));
}

type GuideBuildState = {
  current: number | null;
  currentStart: number;
  candidate: number | null;
  candidateStart: number;
  candidateCount: number;
};

type AdvanceGuideInput = {
  state: GuideBuildState;
  detected: number | null;
  index: number;
  track: ReferencePitchTrack;
  notes: PitchGuideNote[];
};

function advanceGuideState({ state, detected, index, track, notes }: AdvanceGuideInput): void {
  if (detected === state.current) {
    state.candidate = null;
    state.candidateCount = 0;
    return;
  }
  if (detected !== state.candidate) {
    state.candidate = detected;
    state.candidateStart = index;
    state.candidateCount = 1;
    return;
  }

  state.candidateCount++;
  const requiredSamples = stableSampleCount(
    state.candidate === null ? 0.16 : 0.1,
    track.intervalSec,
  );
  if (state.candidateCount < requiredSamples) {
    return;
  }

  const transitionTime = state.candidateStart * track.intervalSec;
  if (state.current !== null && transitionTime - state.currentStart >= 0.1) {
    notes.push({ start: state.currentStart, end: transitionTime, semitone: state.current });
  }
  state.current = state.candidate;
  state.currentStart = transitionTime;
  state.candidate = null;
  state.candidateCount = 0;
}

function segmentPitchTrack(track: ReferencePitchTrack): PitchGuideNote[] {
  const notes: PitchGuideNote[] = [];
  const state: GuideBuildState = {
    current: null,
    currentStart: 0,
    candidate: null,
    candidateStart: 0,
    candidateCount: 0,
  };

  for (let index = 0; index < track.pitches.length; index++) {
    const hz = track.pitches[index];
    advanceGuideState({
      state,
      detected: hz === null ? null : Math.round(freqToSemitone(hz)),
      index,
      track,
      notes,
    });
  }

  const trackEnd = track.pitches.length * track.intervalSec;
  if (state.current !== null && trackEnd - state.currentStart >= 0.1) {
    notes.push({ start: state.currentStart, end: trackEnd, semitone: state.current });
  }
  return notes;
}

function guideRange(notes: PitchGuideNote[]): { low: number; high: number } {
  const semitones = notes.map((note) => note.semitone);
  const low = notes.length > 0 ? Math.min(...semitones) : 48;
  const high = notes.length > 0 ? Math.max(...semitones) : 72;
  const center = (low + high) / 2;

  return {
    low: Math.floor(Math.min(low - 2, center - 12) / 12) * 12,
    high: Math.ceil(Math.max(high + 2, center + 12) / 12) * 12,
  };
}

export function buildPitchGuideTrack(track: ReferencePitchTrack | null): PitchGuideTrack {
  if (!track || track.pitches.length === 0) {
    return { notes: [], lowestSemitone: 48, highestSemitone: 72 };
  }

  const notes = segmentPitchTrack(track);
  const range = guideRange(notes);
  return { notes, lowestSemitone: range.low, highestSemitone: range.high };
}

function createLayout(width: number, height: number, track: PitchGuideTrack): GuideLayout {
  const left = 0;
  const right = width;

  return {
    width,
    height,
    left,
    right,
    top: height * 0.18,
    bottom: height * 0.82,
    playheadX: (left + right) / 2,
    lowestSemitone: track.lowestSemitone,
    highestSemitone: track.highestSemitone,
  };
}

function timeToX(offset: number, layout: GuideLayout): number {
  return layout.playheadX + (offset / VIEW_SECONDS) * ((layout.right - layout.left) / 2);
}

function semitoneToY(semitone: number, layout: GuideLayout): number {
  const range = Math.max(1, layout.highestSemitone - layout.lowestSemitone);
  const normalized = (semitone - layout.lowestSemitone) / range;

  return layout.bottom - normalized * (layout.bottom - layout.top);
}

function setupCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const dpr = window.devicePixelRatio || 1;
  const pixelWidth = Math.floor(width * dpr);
  const pixelHeight = Math.floor(height * dpr);

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx?.clearRect(0, 0, width, height);

  return ctx;
}

function drawLanes(ctx: CanvasRenderingContext2D, layout: GuideLayout): void {
  ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';

  for (let semitone = layout.lowestSemitone; semitone <= layout.highestSemitone; semitone++) {
    const y = semitoneToY(semitone, layout);
    const octave = semitone % 12 === 0;
    ctx.beginPath();
    ctx.moveTo(layout.left, y);
    ctx.lineTo(layout.right, y);
    ctx.strokeStyle = octave ? 'rgba(190,215,255,0.2)' : 'rgba(190,215,255,0.045)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (octave) {
      ctx.fillStyle = 'rgba(220,232,255,0.58)';
      ctx.fillText(`C${Math.floor(semitone / 12) - 1}`, 10, y - 4);
    }
  }
}

function drawTargetNotes(
  ctx: CanvasRenderingContext2D,
  layout: GuideLayout,
  track: PitchGuideTrack,
  currentTime: number,
): void {
  const laneHeight =
    (layout.bottom - layout.top) / (layout.highestSemitone - layout.lowestSemitone);
  const barHeight = Math.max(7, laneHeight * 0.62);

  for (const note of track.notes) {
    if (note.end < currentTime - VIEW_SECONDS || note.start > currentTime + VIEW_SECONDS) {
      continue;
    }

    const x1 = timeToX(note.start - currentTime, layout);
    const x2 = timeToX(note.end - currentTime, layout);
    const y = semitoneToY(note.semitone, layout) - barHeight / 2;
    const active = note.start <= currentTime && note.end >= currentTime;

    ctx.beginPath();
    ctx.roundRect(x1, y, Math.max(3, x2 - x1), barHeight, barHeight / 2);
    ctx.fillStyle = rgba(TARGET_COLOR, active ? 0.42 : 0.22);
    ctx.fill();
    ctx.strokeStyle = rgba(TARGET_COLOR, active ? 1 : 0.72);
    ctx.lineWidth = active ? 2.5 : 1.5;
    ctx.stroke();

    if (x2 - x1 > 34) {
      const noteName = NOTE_NAMES[((note.semitone % 12) + 12) % 12];
      ctx.fillStyle = 'rgba(235,243,255,0.75)';
      ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(noteName, x1 + 7, y + barHeight / 2);
    }
  }
}

function drawPlayerTrail(
  ctx: CanvasRenderingContext2D,
  layout: GuideLayout,
  series: PitchSeries,
  baseColor: Rgb,
): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(4, layout.height / 180);
  let drawing = false;

  for (let index = 0; index < series.userPitches.length; index++) {
    const hz = series.userPitches[index];
    const time = series.times[index];
    if (hz === null || time < series.currentTime - VIEW_SECONDS) {
      drawing = false;
      continue;
    }

    const userSemitone = freqToSemitone(hz);
    const refHz = series.refPitches[index];
    const displaySemitone =
      refHz === null ? userSemitone : snapToRefOctave(freqToSemitone(refHz), userSemitone);
    const x = timeToX(time - series.currentTime, layout);
    const y = semitoneToY(displaySemitone, layout);
    const color = (series.similarities[index] ?? 0) >= 0.85 ? MATCH_COLOR : baseColor;

    if (!drawing) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      drawing = true;
    } else {
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = rgba(color, 0.92);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
}

function drawPlayhead(ctx: CanvasRenderingContext2D, layout: GuideLayout): void {
  const gradient = ctx.createLinearGradient(0, layout.top, 0, layout.bottom);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.12, 'rgba(255,255,255,0.92)');
  gradient.addColorStop(0.88, 'rgba(255,255,255,0.92)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');

  ctx.beginPath();
  ctx.moveTo(layout.playheadX, layout.top - 18);
  ctx.lineTo(layout.playheadX, layout.bottom + 18);
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function renderPitchGuideLanes({
  canvas,
  width,
  height,
  track,
}: RenderPitchGuideLanesInput): void {
  const ctx = setupCanvas(canvas, width, height);
  if (ctx) {
    drawLanes(ctx, createLayout(width, height, track));
  }
}

export function renderPitchGuide({
  canvas,
  width,
  height,
  track,
  series,
  players,
}: RenderPitchGuideInput): void {
  const ctx = setupCanvas(canvas, width, height);
  if (!ctx) {
    return;
  }

  const layout = createLayout(width, height, track);
  drawTargetNotes(ctx, layout, track, series.referenceTime);
  if (players.length > 0) {
    for (const player of players) {
      drawPlayerTrail(ctx, layout, player.series, player.color);
    }
  } else {
    drawPlayerTrail(ctx, layout, series, SOLO_COLOR);
  }
  drawPlayhead(ctx, layout);
}
