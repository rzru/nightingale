export const DEFAULT_LYRICS_SCALE = 1.25;
export const DEFAULT_PITCH_GRAPH_SCALE = 2;
export const PLAYBACK_SCALE_MIN = 0.5;
export const PLAYBACK_SCALE_MAX = 2.5;

export const clampPlaybackScale = (scale: number | null | undefined, fallback: number): number =>
  Math.min(PLAYBACK_SCALE_MAX, Math.max(PLAYBACK_SCALE_MIN, scale ?? fallback));
