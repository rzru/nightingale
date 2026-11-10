import { createContext } from 'react';

import type { PitchSeries } from '@/features/playback/lib/pitch/state';
import type { PlayerColor } from '@/shared/player-colors';

export type RoomRemotePlayer = {
  color: PlayerColor;
  host: boolean;
  name: string;
  score: number;
  series: PitchSeries;
};

export type RoomPlaybackView = {
  /** The local singer, so their own trail and stars use the room identity. */
  self: { color: PlayerColor; id: string; name: string } | null;
  /** Everyone else, keyed by room member id. */
  remote: Map<string, RoomRemotePlayer>;
};

export type RoomPlaybackState = {
  setRoomPlayback: (view: RoomPlaybackView) => void;
  view: RoomPlaybackView;
};

export const RoomPlaybackContextRef = createContext<RoomPlaybackState | null>(null);

export const EMPTY_ROOM_PLAYBACK: RoomPlaybackView = { self: null, remote: new Map() };
