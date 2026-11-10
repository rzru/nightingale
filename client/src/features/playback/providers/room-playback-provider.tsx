/**
 * Room-only view of the other singers, in the shape the mic layer already
 * understands. A room mixes itself in here; without a room every value stays
 * empty and the solo and local-multiplayer paths behave exactly as before.
 */

import { useMemo, useState, type ReactNode } from 'react';

import {
  EMPTY_ROOM_PLAYBACK,
  RoomPlaybackContextRef,
  type RoomPlaybackState,
  type RoomPlaybackView,
} from './room-playback-context';

export function RoomPlaybackProvider({ children }: { children: ReactNode }) {
  const [view, setRoomPlayback] = useState<RoomPlaybackView>(EMPTY_ROOM_PLAYBACK);
  const value = useMemo<RoomPlaybackState>(() => ({ view, setRoomPlayback }), [view]);

  return (
    <RoomPlaybackContextRef.Provider value={value}>{children}</RoomPlaybackContextRef.Provider>
  );
}
