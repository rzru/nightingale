import { useEffect, useRef } from 'react';

import { usePlaybackLauncher } from '@/features/playback/hooks/use-playback-launcher';

import { markPlaybackLaunch } from '../lib/playback-launch';
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
  startAtMs: number | null;
  memberName: string;
  offsetMs: number;
};

export const useRoomLaunch = ({
  session,
  trackHash,
  startAtMs,
  memberName,
  offsetMs,
}: RoomLaunchInput): void => {
  const { launch, reserveTarget } = usePlaybackLauncher();
  const launched = useRef<string | null>(null);
  const { data: songs } = useRoomSongs(trackHash === null ? [] : [trackHash]);

  useEffect(() => {
    if (session === null || trackHash === null || startAtMs === null || songs === undefined) {
      return;
    }

    const song = songs.at(0);
    const key = `${session.joining.roomId}:${startAtMs}`;

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
          memberName,
          startAtMs,
          offsetMs,
        },
      },
      target,
    );
  }, [session, trackHash, startAtMs, memberName, offsetMs, songs, launch, reserveTarget]);
};
