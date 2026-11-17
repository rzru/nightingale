/** Loudness envelope of a track for drawing under the word blocks. */

export const PEAKS_PER_SEC = 100;

export type Peaks = {
  /** Peak amplitude (0..1) per 10 ms. */
  values: Float32Array;
  duration: number;
};

export function computePeaks(buffer: AudioBuffer): Peaks {
  const channel = buffer.numberOfChannels > 0 ? buffer.getChannelData(0) : new Float32Array(0);
  const step = Math.max(1, Math.floor(buffer.sampleRate / PEAKS_PER_SEC));
  const count = Math.ceil(channel.length / step);
  const values = new Float32Array(count);
  let loudest = 0;

  for (let i = 0; i < count; i++) {
    let peak = 0;
    const end = Math.min(channel.length, (i + 1) * step);
    for (let s = i * step; s < end; s++) {
      const amplitude = Math.abs(channel[s]);
      if (amplitude > peak) {
        peak = amplitude;
      }
    }
    values[i] = peak;
    if (peak > loudest) {
      loudest = peak;
    }
  }

  // Quiet recordings still fill the strip.
  if (loudest > 0) {
    for (let i = 0; i < count; i++) {
      values[i] /= loudest;
    }
  }
  return { values, duration: buffer.duration };
}

export async function loadPeaks(url: string): Promise<Peaks> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const context = new AudioContext();
  try {
    return computePeaks(await context.decodeAudioData(await response.arrayBuffer()));
  } finally {
    void context.close();
  }
}

type DrawPeaksInput = {
  canvas: HTMLCanvasElement;
  peaks: Peaks;
  /** Time shown at the left edge and pixels per second. */
  from: number;
  pxPerSec: number;
  color: string;
};

export function drawPeaks({ canvas, peaks, from, pxPerSec, color }: DrawPeaksInput): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = color;

  const middle = height / 2;
  for (let x = 0; x < width; x++) {
    const index = Math.floor((from + x / pxPerSec) * PEAKS_PER_SEC);
    const peak = index >= 0 && index < peaks.values.length ? peaks.values[index] : 0;
    const half = Math.max(0.5, peak * middle);
    ctx.fillRect(x, middle - half, 1, half * 2);
  }
}
