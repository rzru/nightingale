import { useEffect, useMemo, useRef, useState } from 'react';

import { openRoomSocket, toRoomColor, type Joining, type RoomView } from '@/bridge/rooms';
import type { PitchGraphPlayer } from '@/features/playback/components/pitch-graph-canvas';
import { freqToSemitone, type PitchSeries } from '@/features/playback/lib/pitch/state';
import { playerColorOption } from '@/shared/player-colors';
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

type RoomLocal = {
  score: number | null;
  series: PitchSeries;
  /** Local load finished; the room starts once every owner reports in. */
  loaded: boolean;
  skipIntro: () => void;
  skipOutro: () => void;
};

export type RoomPlaybackSync = {
  players: PitchGraphPlayer[];
  /** Host-only in practice: the node rejects skips from anyone else. */
  requestSkip: (kind: 'intro' | 'outro') => void;
};

const NO_PLAYERS: PitchGraphPlayer[] = [];

const clampedStart = (startAtMs: number, now: number): number => {
  if (!Number.isFinite(startAtMs)) {
    return now;
  }

  return Math.min(Math.max(startAtMs, now - MAX_PAST_MS), now + MAX_FUTURE_MS);
};

/**
 * Room-only playback behaviour: hold until the node says the room is playing,
 * keep the local singer's pitch and score flowing, follow the host's skips, and
 * fold every singer's pitch into coloured graph trails.
 *
 * Solo playback passes no room, gets no players back, and opens no socket.
 */
export const useRoomPlayback = (
  room: RoomPlayback | null,
  transport: RoomTransport,
  local: RoomLocal,
): RoomPlaybackSync => {
  const socketRef = useRef<ReturnType<typeof openRoomSocket> | null>(null);
  const offset = useRef(room?.offsetMs ?? 0);
  const started = useRef(false);
  const sentLoaded = useRef(false);
  const sentScore = useRef(0);
  const pending = useRef(new Map<string, RemoteTrack>());
  const view = useRef<RoomView | null>(null);
  const localRef = useRef(local);
  const transportRef = useRef(transport);
  const [remote, setRemote] = useState<Record<string, RemoteTrack>>({});
  const [roomState, setRoomState] = useState<RoomView | null>(null);

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
    sentLoaded.current = false;
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
        if (event.type === 'room.state') {
          view.current = event.state;
          setRoomState(event.state);

          return;
        }

        if (event.type === 'room.skip') {
          if (event.kind === 'intro') {
            transportRef.current.seek(event.positionMs / 1000);
          } else {
            localRef.current.skipOutro();
          }

          return;
        }

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
    // The surface auto-starts when it is ready; the room decides when instead.
    transportRef.current.pauseAudio();

    const startTimer = setInterval(() => {
      if (started.current) {
        return;
      }

      const current = view.current;

      if (current === null || current.phase !== 'playing' || current.startAtMs === null) {
        return;
      }

      const now = Date.now() + offset.current;
      const startAt = clampedStart(current.startAtMs, now);

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
      view.current = null;
      setRoomState(null);
      socket.close();
    };
  }, [room]);

  useEffect(() => {
    if (room === null || !local.loaded || sentLoaded.current) {
      return;
    }

    sentLoaded.current = true;
    socketRef.current?.send({ type: 'room.loaded' });
  }, [room, local.loaded]);

  const requestSkip = useMemo(
    () => (kind: 'intro' | 'outro') => {
      socketRef.current?.send({ type: kind === 'intro' ? 'room.skip_intro' : 'room.skip_outro' });
    },
    [],
  );

  const series = local.series;

  const players = useMemo<PitchGraphPlayer[]>(() => {
    if (room === null) {
      return NO_PLAYERS;
    }

    const members = roomState?.members ?? [];
    const known = new Set(members.map((member) => member.id));
    const colors = new Map(members.map((member) => [member.id, member.color]));
    const own = toRoomColor(room.color);

    return [
      { color: playerColorOption(own).rgb, series },
      ...Object.entries(remote)
        .filter(([id]) => known.has(id))
        .map(([id, track]) => ({
          color: playerColorOption(colors.get(id) ?? own).rgb,
          series: {
            ...series,
            userPitches: track.userPitches,
            displaySemitones: track.displaySemitones,
            similarities: track.similarities,
            times: track.times.map((time) => time / 1000),
          },
        })),
    ];
  }, [room, remote, roomState, series]);

  return { players, requestSkip };
};
