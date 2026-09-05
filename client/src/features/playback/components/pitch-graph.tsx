import { useEffect, useRef, useState } from 'react';

import { clampPlaybackScale } from '@/features/playback/lib/display-scale';
import { PITCH_BUFFER_SIZE } from '@/features/playback/lib/pitch/constants';
import type { PitchSeries } from '@/features/playback/lib/pitch/state';
import { freqToSemitone, snapToRefOctave } from '@/features/playback/lib/pitch/state';
import { usePlaybackMicState } from '@/features/playback/providers';
import type { Rgb } from '@/types/Rgb';

type CanvasLayout = {
  width: number;
  height: number;
  paddingX: number;
  paddingY: number;
  plotWidth: number;
  plotHeight: number;
  lineWidth: number;
};

type PlotPoint = {
  x: number;
  y: number;
  color: Rgb;
  alpha: number;
};

const BASE_DISPLAY_WIDTH = 400;
const BASE_DISPLAY_HEIGHT = 44;
const REFERENCE_HEIGHT = 1080;
const MIN_DISPLAY_SCALE = 0.85;

const LOWEST_VISIBLE_SEMITONE = 45;
const VISIBLE_SEMITONE_RANGE = 36;

const OLDEST_POINT_ALPHA = 0.25;
const NEWEST_POINT_ALPHA = 1.0;

const REF_LINE_COLOR: Rgb = { r: 0.5, g: 0.7, b: 1.0 };
const REF_LINE_ALPHA = 0.55;

const USER_BASE_COLOR: Rgb = { r: 0.85, g: 0.85, b: 1.0 };
const USER_ALPHA_WITHOUT_REF = 0.55;
const USER_ALPHA_MIN_WITH_REF = 0.35;
const USER_ALPHA_MAX_WITH_REF = 1.0;

const SIMILARITY_GOOD: Rgb = { r: 0.2, g: 0.9, b: 0.3 };
const SIMILARITY_OK: Rgb = { r: 0.95, g: 0.8, b: 0.1 };
const SIMILARITY_BAD: Rgb = { r: 0.9, g: 0.2, b: 0.2 };
const SIMILARITY_OK_THRESHOLD = 0.7;

function displayScale(windowHeight: number): number {
  return Math.max(MIN_DISPLAY_SCALE, windowHeight / REFERENCE_HEIGHT);
}

function computeLayout(windowHeight: number, windowWidth: number, userScale: number): CanvasLayout {
  const scale = displayScale(windowHeight) * userScale;
  const width = Math.min(BASE_DISPLAY_WIDTH * scale, Math.max(240, windowWidth - 32));
  const height = BASE_DISPLAY_HEIGHT * scale;
  const paddingX = 8 * scale;
  const paddingY = 6 * scale;

  return {
    width,
    height,
    paddingX,
    paddingY,
    plotWidth: width - paddingX * 2,
    plotHeight: height - paddingY * 2,
    lineWidth: Math.max(2.25, 2 * scale),
  };
}

function lerpRgb(from: Rgb, to: Rgb, t: number): Rgb {
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  };
}

function similarityToColor(similarity: number): Rgb {
  if (similarity >= SIMILARITY_OK_THRESHOLD) {
    const t = (similarity - SIMILARITY_OK_THRESHOLD) / (1 - SIMILARITY_OK_THRESHOLD);
    return lerpRgb(SIMILARITY_OK, SIMILARITY_GOOD, t);
  }

  const t = Math.max(0, similarity / SIMILARITY_OK_THRESHOLD);
  return lerpRgb(SIMILARITY_BAD, SIMILARITY_OK, t);
}

function rgbaString({ r, g, b }: Rgb, alpha: number): string {
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${alpha})`;
}

function semitoneToY(semitone: number, layout: CanvasLayout): number {
  const normalized = Math.min(
    1,
    Math.max(0, (semitone - LOWEST_VISIBLE_SEMITONE) / VISIBLE_SEMITONE_RANGE),
  );

  return layout.paddingY + (1 - normalized) * layout.plotHeight;
}

function indexToX(index: number, seriesLength: number, layout: CanvasLayout): number {
  const xStep = layout.plotWidth / (PITCH_BUFFER_SIZE - 1);
  const bufferOffset = PITCH_BUFFER_SIZE - seriesLength;

  return layout.paddingX + (bufferOffset + index) * xStep;
}

function ageAlpha(index: number, seriesLength: number): number {
  const t = index / Math.max(1, seriesLength - 1);

  return OLDEST_POINT_ALPHA + (NEWEST_POINT_ALPHA - OLDEST_POINT_ALPHA) * t;
}

function setupCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  layout: CanvasLayout,
): void {
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.floor(layout.width * dpr);
  canvas.height = Math.floor(layout.height * dpr);
  canvas.style.width = `${layout.width}px`;
  canvas.style.height = `${layout.height}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, layout.width, layout.height);
}

function tracePath(ctx: CanvasRenderingContext2D, points: PlotPoint[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
}

function strokeUniformSegment(
  ctx: CanvasRenderingContext2D,
  points: PlotPoint[],
  lineWidth: number,
): void {
  if (points.length < 2) {
    return;
  }

  tracePath(ctx, points);

  ctx.strokeStyle = rgbaString(points[0].color, points[0].alpha);
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function strokeGradientSegment(
  ctx: CanvasRenderingContext2D,
  points: PlotPoint[],
  lineWidth: number,
): void {
  if (points.length < 2) {
    return;
  }

  tracePath(ctx, points);

  const gradient = ctx.createLinearGradient(points[0].x, 0, points[points.length - 1].x, 0);
  for (let i = 0; i < points.length; i++) {
    gradient.addColorStop(i / (points.length - 1), rgbaString(points[i].color, points[i].alpha));
  }

  ctx.strokeStyle = gradient;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function buildSegments<T>(
  values: readonly (number | null)[],
  toPoint: (value: number, index: number) => T,
): T[][] {
  const segments: T[][] = [];
  let current: T[] = [];

  for (let i = 0; i < values.length; i++) {
    const value = values[i];

    if (value === null) {
      if (current.length >= 2) {
        segments.push(current);
      }
      current = [];
      continue;
    }

    current.push(toPoint(value, i));
  }

  if (current.length >= 2) {
    segments.push(current);
  }

  return segments;
}

function buildReferencePoint(
  hz: number,
  index: number,
  seriesLength: number,
  layout: CanvasLayout,
): PlotPoint {
  return {
    x: indexToX(index, seriesLength, layout),
    y: semitoneToY(freqToSemitone(hz), layout),
    color: REF_LINE_COLOR,
    alpha: REF_LINE_ALPHA * ageAlpha(index, seriesLength),
  };
}

function userPointStyle(similarity: number, hasRef: boolean): { color: Rgb; weight: number } {
  if (!hasRef) {
    return { color: USER_BASE_COLOR, weight: USER_ALPHA_WITHOUT_REF };
  }

  return {
    color: lerpRgb(USER_BASE_COLOR, similarityToColor(similarity), similarity),
    weight:
      USER_ALPHA_MIN_WITH_REF + similarity * (USER_ALPHA_MAX_WITH_REF - USER_ALPHA_MIN_WITH_REF),
  };
}

function buildUserPoint(
  userHz: number,
  index: number,
  series: PitchSeries,
  layout: CanvasLayout,
): PlotPoint {
  const seriesLength = series.userPitches.length;
  const refHz = series.refPitches[index];

  const userSemi = freqToSemitone(userHz);
  const displaySemi = refHz !== null ? snapToRefOctave(freqToSemitone(refHz), userSemi) : userSemi;

  const similarity = series.similarities[index] ?? 0;
  const { color, weight } = userPointStyle(similarity, refHz !== null);

  return {
    x: indexToX(index, seriesLength, layout),
    y: semitoneToY(displaySemi, layout),
    color,
    alpha: weight * ageAlpha(index, seriesLength),
  };
}

function drawPitchSeries(
  ctx: CanvasRenderingContext2D,
  layout: CanvasLayout,
  series: PitchSeries,
): void {
  const length = series.refPitches.length;
  if (length < 2) {
    return;
  }

  const refSegments = buildSegments(series.refPitches, (hz, i) =>
    buildReferencePoint(hz, i, length, layout),
  );

  for (const segment of refSegments) {
    strokeUniformSegment(ctx, segment, layout.lineWidth);
  }

  const userSegments = buildSegments(series.userPitches, (hz, i) =>
    buildUserPoint(hz, i, series, layout),
  );

  for (const segment of userSegments) {
    strokeGradientSegment(ctx, segment, layout.lineWidth);
  }
}

function useWindowSize(): { height: number; width: number } {
  const [size, setSize] = useState(() => ({
    height: window.innerHeight,
    width: window.innerWidth,
  }));

  useEffect(() => {
    const onResize = () => setSize({ height: window.innerHeight, width: window.innerWidth });

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return size;
}

type PitchGraphProps = {
  series: PitchSeries;
  position?: 'top' | 'bottom';
  scale?: number | null;
  recordingActive?: boolean;
};

const graphPositionClass = (position: 'top' | 'bottom', recordingActive: boolean): string => {
  if (position === 'top') {
    return 'top-2 sm:top-3';
  }

  return recordingActive ? 'bottom-[10rem]' : 'bottom-2 sm:bottom-3';
};

export function PitchGraph({
  series,
  position = 'top',
  scale = 1,
  recordingActive = false,
}: PitchGraphProps) {
  const { micReady: visible } = usePlaybackMicState();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { height: windowHeight, width: windowWidth } = useWindowSize();

  useEffect(() => {
    if (!visible) {
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      return;
    }

    const layout = computeLayout(windowHeight, windowWidth, clampPlaybackScale(scale));

    setupCanvas(canvas, ctx, layout);
    drawPitchSeries(ctx, layout, series);
  }, [series, visible, windowHeight, windowWidth, scale]);

  if (!visible) {
    return null;
  }

  const positionClass = graphPositionClass(position, recordingActive);

  return (
    <div
      className={`pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 rounded-sm border-white/15 bg-black/40 p-1 ${positionClass}`}
    >
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}
