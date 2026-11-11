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

/**
 * The track a singer just left. Returning to the room screen while the song is
 * still playing must not reopen the surface immediately; the next arming
 * clears it.
 */
let exitedTrack: string | null = null;

export const markPlaybackExit = (trackHash: string): void => {
  exitedTrack = trackHash;
};

export const clearPlaybackExit = (): void => {
  exitedTrack = null;
};

export const isPlaybackExit = (trackHash: string): boolean => exitedTrack === trackHash;
