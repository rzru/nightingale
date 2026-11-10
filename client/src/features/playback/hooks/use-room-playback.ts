import { useEffect, useMemo, useRef, useState } from 'react';

import { openRoomSocket, toRoomColor, type Joining, type RoomView } from '@/bridge/rooms';
import { freqToSemitone, type PitchSeries } from '@/features/playback/lib/pitch/state';
import { useSetRoomPlayback } from '@/features/playback/providers/room-playback-hooks';
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

type RoomEventContext = {
  local: RoomLocal;
  transport: RoomTransport;
  pending: Map<string, RemoteTrack>;
  setRoomState: (state: RoomView | null) => void;
  view: RoomView | null;
};

const applyState = (next: RoomView, previous: RoomView | null, transport: RoomTransport): void => {
  if (next.phase === 'playing' && next.paused) {
    transport.pauseAudio();

    return;
  }

  if (previous?.paused === true && !next.paused) {
    transport.seek(next.positionMs / 1000);
    transport.resume();
  }
};

const applySkip = (
  kind: 'intro' | 'outro',
  positionMs: number,
  transport: RoomTransport,
  local: RoomLocal,
): void => {
  if (kind === 'intro') {
    transport.seek(positionMs / 1000);

    return;
  }

  local.skipOutro();
};

const driftTarget = (
  state: RoomView | null,
  now: number,
  positionSec: number,
  settled: boolean,
): number | null => {
  if (!settled || state === null || state.phase !== 'playing' || state.paused) {
    return null;
  }

  if (state.startAtMs === null) {
    return null;
  }

  const expected = (now - state.startAtMs) / 1000;

  if (expected < 0 || Math.abs(positionSec - expected) <= MAX_DRIFT_SEC) {
    return null;
  }

  return expected;
};

const collectPitch = (
  memberId: string,
  hz: number | null,
  pending: Map<string, RemoteTrack>,
): void => {
  const track = pending.get(memberId) ?? newTrack();
  pushSample(track, hz, Date.now());
  pending.set(memberId, track);
};

const roomEvents = (
  event: Parameters<Parameters<typeof openRoomSocket>[2]['onEvent']>[0],
  ctx: RoomEventContext,
): void => {
  if (event.type === 'room.state') {
    applyState(event.state, ctx.view, ctx.transport);
    ctx.setRoomState(event.state);

    return;
  }

  if (event.type === 'room.skip') {
    applySkip(event.kind, event.positionMs, ctx.transport, ctx.local);

    return;
  }

  if (event.type === 'room.pitch') {
    collectPitch(event.memberId, event.hz, ctx.pending);
  }
};

type RoomTransport = {
  getCurrentTime: () => number;
  pauseAudio: () => void;
  resume: () => void;
  seek: (time: number) => void;
  startPlayback: () => void;
};

/** Beyond this the singers are audibly apart; below it, seeking would be worse. */
const MAX_DRIFT_SEC = 0.35;
const DRIFT_CHECK_MS = 1000;
const DRIFT_SETTLE_MS = 2000;

type RoomLocal = {
  score: number | null;
  series: PitchSeries;
  /** Local load finished; the room starts once every owner reports in. */
  loaded: boolean;
  skipIntro: () => void;
  skipOutro: () => void;
};

export type RoomPlaybackSync = {
  /** Host-only in practice: the node rejects skips from anyone else. */
  requestSkip: (kind: 'intro' | 'outro') => void;
  /** Transport intents go through the room so every machine follows. */
  requestPause: () => void;
  requestResume: () => void;
};

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
  const [remote, setRemote] = useState<Map<string, RemoteTrack>>(new Map());
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
        if (event.type === 'room.pitch' && event.memberId === room.memberId) {
          return;
        }

        if (event.type === 'room.state') {
          view.current = event.state;
        }

        roomEvents(event, {
          view: view.current,
          local: localRef.current,
          transport: transportRef.current,
          pending: pending.current,
          setRoomState,
        });
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

    let startedAt = 0;
    const driftTimer = setInterval(() => {
      if (started.current && startedAt === 0) {
        startedAt = Date.now();
      }

      const settled = startedAt > 0 && Date.now() - startedAt >= DRIFT_SETTLE_MS;
      const target = driftTarget(
        view.current,
        Date.now() + offset.current,
        transportRef.current.getCurrentTime(),
        settled,
      );

      if (target !== null) {
        transportRef.current.seek(target);
      }
    }, DRIFT_CHECK_MS);

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
      setRemote(new Map(pending.current));
    }, REPAINT_INTERVAL_MS);

    return () => {
      clearInterval(startTimer);
      clearInterval(driftTimer);
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

  const requestPause = useMemo(
    () => () => {
      socketRef.current?.send({ type: 'room.pause' });
    },
    [],
  );

  const requestResume = useMemo(
    () => () => {
      socketRef.current?.send({ type: 'room.resume' });
    },
    [],
  );

  const series = local.series;
  const setRoomPlayback = useSetRoomPlayback();

  // Publish the room as players so the mic layer (and therefore the HUD and the
  // graph) renders remote singers exactly like local-multiplayer ones.
  useEffect(() => {
    if (setRoomPlayback === null) {
      return undefined;
    }

    if (room === null || roomState === null) {
      setRoomPlayback({ self: null, remote: new Map() });

      return undefined;
    }

    const me = roomState.members.find((member) => member.id === room.memberId);

    setRoomPlayback({
      self: me === undefined ? null : { id: me.id, name: me.name, color: toRoomColor(me.color) },
      remote: new Map(
        roomState.members
          .filter((member) => member.id !== room.memberId)
          .map((member) => {
            const track = remote.get(member.id);

            return [
              member.id,
              {
                name: member.name,
                color: toRoomColor(member.color),
                host: member.host,
                score: member.score,
                series: {
                  ...series,
                  userPitches: track?.userPitches ?? [],
                  displaySemitones: track?.displaySemitones ?? [],
                  similarities: track?.similarities ?? [],
                  times: (track?.times ?? []).map((time) => time / 1000),
                },
              },
            ] as const;
          }),
      ),
    });

    return undefined;
  }, [room, roomState, remote, series, setRoomPlayback]);

  return { requestPause, requestResume, requestSkip };
};
