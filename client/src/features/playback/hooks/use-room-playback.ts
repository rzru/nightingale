import { useEffect, useMemo, useRef, useState } from 'react';

import { openRoomSocket, type Joining } from '@/bridge/rooms';
import type { PitchGraphPlayer } from '@/features/playback/components/pitch-graph-canvas';
import { freqToSemitone, type PitchSeries } from '@/features/playback/lib/pitch/state';
import type { RoomPlayback } from '@/types/RoomPlayback';

/** Lead time before the shared start, so `seek` + `play` land on the beat. */
const START_LEAD_MS = 150;
/** A node may not schedule a start far in the future, or force a big seek. */
const MAX_FUTURE_MS = 5 * 60 * 1000;
const MAX_PAST_MS = 60 * 1000;
const PITCH_INTERVAL_MS = 100;
const SCORE_INTERVAL_MS = 5000;
const REPAINT_INTERVAL_MS = 250;
const MAX_REMOTE_SAMPLES = 400;

/** Fixed palette for remote singers; the local singer keeps their own colour. */
const REMOTE_COLORS = [
  { r: 244, g: 114, b: 182 },
  { r: 245, g: 158, b: 11 },
  { r: 16, g: 185, b: 129 },
  { r: 139, g: 92, b: 246 },
];

type RemoteTrack = {
  times: number[];
  userPitches: (number | null)[];
  displaySemitones: (number | null)[];
  similarities: number[];
};

const newTrack = (): RemoteTrack => ({
  times: [],
  userPitches: [],
  displaySemitones: [],
  similarities: [],
});

const pushSample = (track: RemoteTrack, hz: number | null, atMs: number): void => {
  if (track.times.length >= MAX_REMOTE_SAMPLES) {
    track.times.shift();
    track.userPitches.shift();
    track.displaySemitones.shift();
    track.similarities.shift();
  }

  track.times.push(atMs);
  track.userPitches.push(hz);
  track.displaySemitones.push(hz === null ? null : freqToSemitone(hz) - 69);
  track.similarities.push(0);
};

type RoomTransport = {
  pauseAudio: () => void;
  seek: (time: number) => void;
  startPlayback: () => void;
};

export type RoomPlaybackSync = { players: PitchGraphPlayer[] };

const NO_PLAYERS: PitchGraphPlayer[] = [];

/**
 * Room-only playback behaviour: hold until the shared start, keep the local
 * singer's pitch and score flowing to the node, and fold everyone else's pitch
 * into graph trails.
 *
 * Solo playback passes no room, gets no players back, and opens no socket.
 */
export const useRoomPlayback = (
  room: RoomPlayback | null,
  transport: RoomTransport,
  local: { score: number | null; series: PitchSeries },
): RoomPlaybackSync => {
  const socketRef = useRef<ReturnType<typeof openRoomSocket> | null>(null);
  const offset = useRef(room?.offsetMs ?? 0);
  const started = useRef(false);
  const sentScore = useRef(0);
  const pending = useRef(new Map<string, RemoteTrack>());
  const localRef = useRef(local);
  const transportRef = useRef(transport);
  const [remote, setRemote] = useState<Record<string, RemoteTrack>>({});

  useEffect(() => {
    localRef.current = local;
    transportRef.current = transport;
  });

  useEffect(() => {
    if (room === null) {
      return undefined;
    }

    pending.current = new Map();
    started.current = false;
    sentScore.current = 0;
    offset.current = room.offsetMs;

    const joining: Joining = {
      roomId: room.roomId,
      memberId: room.memberId,
      token: room.token,
    };
    const socket = openRoomSocket(room.nodeUrl, joining, {
      onClock: (measured) => {
        offset.current = measured;
      },
      onEvent: (event) => {
        if (event.type !== 'room.pitch' || event.memberId === room.memberId) {
          return;
        }

        const track = pending.current.get(event.memberId) ?? newTrack();
        pushSample(track, event.hz, Date.now());
        pending.current.set(event.memberId, track);
      },
      onClose: () => undefined,
    });

    socketRef.current = socket;
    // The surface auto-starts when it is ready; hold it for the room instead.
    transportRef.current.pauseAudio();

    // Clamp the node's timestamp to a plausible window: far-future becomes
    // "start now", far-past becomes "start from the top" instead of a seek to
    // an hour into a three-minute song.
    const initial = Date.now() + offset.current;
    const startAt = Number.isFinite(room.startAtMs)
      ? Math.min(Math.max(room.startAtMs, initial - MAX_PAST_MS), initial + MAX_FUTURE_MS)
      : initial;

    const startTimer = setInterval(() => {
      if (started.current) {
        return;
      }

      const now = Date.now() + offset.current;

      if (now >= startAt - START_LEAD_MS) {
        started.current = true;
        transportRef.current.seek(Math.max(0, (now - startAt) / 1000));
        transportRef.current.startPlayback();
      }
    }, 50);

    const pitchTimer = setInterval(() => {
      const hz = localRef.current.series.userPitches.at(-1) ?? null;
      socketRef.current?.send({ type: 'room.pitch', hz, rms: null });
    }, PITCH_INTERVAL_MS);

    const scoreTimer = setInterval(() => {
      const total = Math.round(localRef.current.score ?? 0);
      const delta = total - sentScore.current;

      if (delta > 0) {
        sentScore.current = total;
        socketRef.current?.send({ type: 'room.score', delta });
      }
    }, SCORE_INTERVAL_MS);

    const repaintTimer = setInterval(() => {
      setRemote(Object.fromEntries(pending.current));
    }, REPAINT_INTERVAL_MS);

    return () => {
      clearInterval(startTimer);
      clearInterval(pitchTimer);
      clearInterval(scoreTimer);
      clearInterval(repaintTimer);
      socketRef.current = null;
      socket.close();
    };
  }, [room]);

  const series = local.series;

  return useMemo<RoomPlaybackSync>(() => {
    if (room === null) {
      return { players: NO_PLAYERS };
    }

    const players = Object.entries(remote).map(([, track], index) => ({
      color: REMOTE_COLORS[index % REMOTE_COLORS.length] ?? REMOTE_COLORS[0],
      series: {
        ...series,
        userPitches: track.userPitches,
        displaySemitones: track.displaySemitones,
        similarities: track.similarities,
        times: track.times.map((time) => time / 1000),
      },
    }));

    return { players };
  }, [room, remote, series]);
};
