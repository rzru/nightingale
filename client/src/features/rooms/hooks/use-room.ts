import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  loadRooms,
  openRoomSocket,
  type Joining,
  type RoomClientFrame,
  type RoomSocket,
  type RoomView,
} from '@/bridge/rooms';
import { loadSongsByHashes } from '@/bridge/songs';

import { isPlaybackLaunch } from '../lib/playback-launch';

export type RoomSession = { joining: Joining; nodeUrl: string };

export const useRooms = (nodeUrl: string | null) =>
  useQuery({
    queryKey: ['rooms-list', nodeUrl],
    queryFn: () => loadRooms(nodeUrl ?? ''),
    enabled: nodeUrl !== null,
    refetchInterval: 5000,
  });

/**
 * Live room membership. `session` must keep a stable identity (store it in
 * state, not inline) so the socket is not reopened on every render.
 */
export const useRoom = (session: RoomSession | null) => {
  const socketRef = useRef<RoomSocket | null>(null);
  const [state, setState] = useState<RoomView | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [offsetMs, setOffsetMs] = useState(0);
  const [presence, setPresence] = useState<{ hash: string; present: boolean } | null>(null);

  useEffect(() => {
    const socket =
      session === null
        ? null
        : openRoomSocket(session.nodeUrl, session.joining, {
            onClock: setOffsetMs,
            onEvent: (event) => {
              if (event.type === 'room.state') {
                setState(event.state);
              } else if (event.type === 'room.deny') {
                setDenied(event.reason);
              } else if (event.type === 'room.closed') {
                setClosed(true);
              }
            },
            onClose: () => {
              setClosed(true);
            },
          });

    socketRef.current = socket;

    return () => {
      socketRef.current = null;

      if (isPlaybackLaunch()) {
        socket?.close();
      } else {
        socket?.leave();
      }
    };
  }, [session]);

  const send = useCallback((frame: RoomClientFrame) => {
    socketRef.current?.send(frame);
  }, []);

  const trackHash = state?.track?.hash ?? null;

  // The node cannot know what is on this machine, so the client reports
  // presence and the node gates `ready` on it.
  useEffect(() => {
    if (trackHash === null) {
      return;
    }

    void (async () => {
      try {
        const songs = await loadSongsByHashes([trackHash]);
        const present = songs.length > 0;
        setPresence({ hash: trackHash, present });
        socketRef.current?.send({ type: 'room.has_track', hasTrack: present });
      } catch {
        setPresence({ hash: trackHash, present: false });
      }
    })();
  }, [trackHash]);

  const me = state?.members.find((member) => member.id === session?.joining.memberId) ?? null;
  const hasTrack = trackHash !== null && presence?.hash === trackHash ? presence.present : null;

  return {
    closed,
    denied,
    hasTrack,
    isHost: me?.host === true,
    me,
    offsetMs,
    send,
    state,
  };
};
