/**
 * Set for a few seconds around a playback launch. The room screen unmounts when
 * playback takes over, and its cleanup must then keep the seat instead of
 * releasing it — the playback surface is what holds the seat next.
 */
let launchedAt = 0;
const WINDOW_MS = 5000;

export const markPlaybackLaunch = (): void => {
  launchedAt = Date.now();
};

export const isPlaybackLaunch = (): boolean => Date.now() - launchedAt < WINDOW_MS;
