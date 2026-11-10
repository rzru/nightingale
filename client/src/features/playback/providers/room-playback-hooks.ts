import { useContext } from 'react';

import { RoomPlaybackContextRef, type RoomPlaybackView } from './room-playback-context';

/** Null outside a room: the mic layer then behaves as a plain solo session. */
export const useRoomPlaybackView = (): RoomPlaybackView | null =>
  useContext(RoomPlaybackContextRef)?.view ?? null;

/** Used by the room sync hook, which sits below the providers. */
export const useSetRoomPlayback = (): ((view: RoomPlaybackView) => void) | null =>
  useContext(RoomPlaybackContextRef)?.setRoomPlayback ?? null;
