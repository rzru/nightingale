import { useEffect, useRef } from 'react';

import type { RoomView } from '@/bridge/rooms';
import { usePlaybackLauncher } from '@/features/playback/hooks/use-playback-launcher';

import { clearPlaybackExit, isPlaybackExit, markPlaybackLaunch } from '../lib/playback-launch';
import type { RoomSession } from './use-room';
import { useRoomSongs } from './use-room-song';

/**
 * Launches the local playback surface when the room starts a track.
 *
 * Every singer loads their own copy by hash — nothing is transferred. The room
 * only contributes the shared start time and the clock offset measured while
 * sitting in it, both carried in the playback session so solo playback never
 * sees them.
 */
type RoomLaunchInput = {
  session: RoomSession | null;
  trackHash: string | null;
  /** Arming already opens the surface; the start time arrives over the socket. */
  phase: RoomView['phase'];
  /** Only the host and singers who readied up join the playback. */
  participating: boolean;
  offsetMs: number;
};

export const useRoomLaunch = ({
  session,
  trackHash,
  phase,
  participating,
  offsetMs,
}: RoomLaunchInput): void => {
  const { launch, reserveTarget } = usePlaybackLauncher();
  const launched = useRef<string | null>(null);
  const { data: songs } = useRoomSongs(trackHash === null ? [] : [trackHash]);

  // A new arming is a fresh song: stop suppressing the track we just left.
  // The lobby ends a song, so the same track may be picked again.
  useEffect(() => {
    if (phase === 'arming') {
      clearPlaybackExit();
    }
    if (phase === 'lobby') {
      launched.current = null;
      clearPlaybackExit();
    }
  }, [phase]);

  useEffect(() => {
    if (session === null || trackHash === null || songs === undefined) {
      return;
    }
    if (phase !== 'arming' && phase !== 'playing') {
      return;
    }
    if (!participating || isPlaybackExit(trackHash)) {
      return;
    }

    const song = songs.at(0);
    const key = `${session.joining.roomId}:${trackHash}`;

    if (song === undefined || launched.current === key) {
      return;
    }

    launched.current = key;
    markPlaybackLaunch();
    const target = reserveTarget();

    void launch(
      {
        song,
        queuePlayback: false,
        playbackId: key,
        room: {
          nodeUrl: session.nodeUrl,
          roomId: session.joining.roomId,
          token: session.joining.token,
          memberId: session.joining.memberId,
          offsetMs,
        },
      },
      target,
    );
  }, [session, trackHash, phase, participating, offsetMs, songs, launch, reserveTarget]);
};
