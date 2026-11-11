import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { openRoomSocket, toRoomColor, type Joining, type RoomView } from '@/bridge/rooms';
import type { PitchSeries } from '@/features/playback/lib/pitch/state';
import { useSetRoomPlayback } from '@/features/playback/providers/room-playback-hooks';
import type { RoomPlayback } from '@/types/RoomPlayback';

/** Pitch samples fan out at 20 Hz: dense enough for the graph, cheap for a node. */
const PITCH_INTERVAL_MS = 50;
const SCORE_INTERVAL_MS = 1000;
const REPAINT_INTERVAL_MS = 100;
/** Retry the shared start until the buffers exist and the clock was scheduled. */
const ALIGN_RETRY_MS = 100;
const DRIFT_CHECK_MS = 1000;
/** Corrections before this would fight the scheduling itself. */
const DRIFT_SETTLE_MS = 2000;
const MAX_DRIFT_SEC = 0.35;
const MAX_REMOTE_SAMPLES = 400;

type RemoteTrack = {
  /** Song position in seconds, so the graph can place remote samples. */
  times: number[];
  pitches: (number | null)[];
  semitones: (number | null)[];
  similarities: number[];
};

type RemoteSample = {
  hz: number | null;
  semitone: number | null;
  similarity: number;
  positionMs: number;
};

const newTrack = (): RemoteTrack => ({
  times: [],
  pitches: [],
  semitones: [],
  similarities: [],
});

const pushSample = (track: RemoteTrack, sample: RemoteSample): void => {
  if (track.times.length >= MAX_REMOTE_SAMPLES) {
    track.times.shift();
    track.pitches.shift();
    track.semitones.shift();
    track.similarities.shift();
  }

  track.times.push(sample.positionMs / 1000);
  track.pitches.push(sample.hz);
  track.semitones.push(sample.semitone);
  track.similarities.push(sample.similarity);
};

type RoomTransport = {
  getCurrentTime: () => number;
  /** Pauses the engine and raises the pause overlay, like a local pause. */
  handlePause: () => void;
  /** Seeks to `time` and starts on the shared clock, `delaySec` from now. */
  startAt: (time: number, delaySec: number) => boolean;
};

type RoomLocal = {
  score: number;
  series: PitchSeries;
  /** Local load finished; the room starts once every owner reports in. */
  loaded: boolean;
  /** Where a local intro skip should land, in seconds. */
  introTargetSec: number;
  skipOutro: () => void;
};

type RoomDerived = {
  isHost: boolean;
  playing: boolean;
  pausedById: string | null;
  pausedByName: string | null;
  /** Singers who must load before the room starts, and how many already did. */
  loaded: number;
  total: number;
};

export type RoomPlaybackSync = RoomDerived & {
  requestPause: () => void;
  requestResume: () => void;
  requestSeek: (time: number) => void;
  /** Transport intents go through the room so every machine follows. */
  requestSkip: (kind: 'intro' | 'outro') => void;
};

const EMPTY_ROOM_DERIVED: RoomDerived = {
  isHost: false,
  playing: false,
  pausedById: null,
  pausedByName: null,
  loaded: 0,
  total: 0,
};

function deriveRoom(state: RoomView | null, room: RoomPlayback | null): RoomDerived {
  if (state === null) {
    return EMPTY_ROOM_DERIVED;
  }

  const required = state.members.filter(
    (member) => member.host || (member.hasTrack && member.ready),
  );

  return {
    isHost: room !== null && state.hostId === room.memberId,
    playing: state.phase === 'playing',
    pausedById: state.pausedById,
    pausedByName: state.pausedBy,
    loaded: required.filter((member) => member.loaded).length,
    total: required.length,
  };
}

/**
 * Room-only playback behaviour: hold until the node schedules the shared start,
 * align against its clock, keep the local singer's pitch and score flowing,
 * follow the host's skips and seeks, and fold every singer's pitch into
 * coloured graph trails.
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
  /** `startAt:startPosition` of the timeline this client already scheduled. */
  const alignedKey = useRef<string | null>(null);
  const clockMeasured = useRef(false);
  const pauseApplied = useRef(false);
  const pending = useRef(new Map<string, RemoteTrack>());
  const view = useRef<RoomView | null>(null);
  const localRef = useRef(local);
  const transportRef = useRef(transport);
  const lastSentPosition = useRef(-1);
  const sentScore = useRef(0);
  const loadedSent = useRef(false);
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
    alignedKey.current = null;
    clockMeasured.current = false;
    pauseApplied.current = false;
    lastSentPosition.current = -1;
    sentScore.current = 0;
    loadedSent.current = false;
    offset.current = room.offsetMs;
    view.current = null;

    const align = (): void => {
      const state = view.current;

      if (!clockMeasured.current) {
        return;
      }
      if (state === null || state.phase !== 'playing' || state.paused) {
        return;
      }
      if (state.startAtMs === null) {
        return;
      }

      const key = `${state.startAtMs}:${state.startPositionMs}`;

      if (alignedKey.current === key) {
        return;
      }

      const now = Date.now() + offset.current;
      const delay = (state.startAtMs - now) / 1000;
      const offsetSec = state.startPositionMs / 1000 + Math.max(0, -delay);

      if (!transportRef.current.startAt(offsetSec, Math.max(0, delay))) {
        return;
      }

      alignedKey.current = key;
      // A seek or skip rewinds the song clock; stale samples must not block pitch.
      lastSentPosition.current = -1;
    };

    const joining: Joining = {
      roomId: room.roomId,
      memberId: room.memberId,
      token: room.token,
    };
    const socket = openRoomSocket(room.nodeUrl, joining, {
      onClock: (measured) => {
        offset.current = measured;
        clockMeasured.current = true;
        align();
      },
      onEvent: (event) => {
        if (event.type === 'room.pitch') {
          if (event.memberId === room.memberId) {
            return;
          }

          const track = pending.current.get(event.memberId) ?? newTrack();
          pushSample(track, event);
          pending.current.set(event.memberId, track);

          return;
        }

        if (event.type === 'room.state') {
          view.current = event.state;
          setRoomState(event.state);

          if (event.state.phase === 'playing' && event.state.paused) {
            if (!pauseApplied.current) {
              pauseApplied.current = true;
              transportRef.current.handlePause();
            }

            return;
          }

          pauseApplied.current = false;
          align();

          return;
        }

        if (event.type === 'room.skip' && event.kind === 'outro') {
          localRef.current.skipOutro();
        }
      },
      onClose: () => undefined,
    });

    socketRef.current = socket;

    const alignTimer = setInterval(() => {
      const state = view.current;

      // `room.loaded` only counts after the snapshot proves the socket is open.
      if (!loadedSent.current && localRef.current.loaded && state?.phase === 'arming') {
        loadedSent.current = true;
        socketRef.current?.send({ type: 'room.loaded' });
      }

      align();
    }, ALIGN_RETRY_MS);

    // Safety net only: the scheduled start keeps singers within a few ms, but a
    // long suspension or a slow decode must not leave one machine adrift.
    const driftTimer = setInterval(() => {
      const state = view.current;

      if (state === null || state.phase !== 'playing' || state.paused) {
        return;
      }
      if (state.startAtMs === null) {
        return;
      }

      const now = Date.now() + offset.current;

      if (now < state.startAtMs + DRIFT_SETTLE_MS) {
        return;
      }

      const target = state.startPositionMs / 1000 + (now - state.startAtMs) / 1000;

      if (Math.abs(transportRef.current.getCurrentTime() - target) <= MAX_DRIFT_SEC) {
        return;
      }

      alignedKey.current = null;
      align();
    }, DRIFT_CHECK_MS);

    const pitchTimer = setInterval(() => {
      const series = localRef.current.series;
      const index = series.times.length - 1;

      if (index < 0) {
        return;
      }

      const positionMs = Math.round((series.times.at(-1) ?? 0) * 1000);

      if (positionMs <= lastSentPosition.current) {
        return;
      }

      lastSentPosition.current = positionMs;
      socketRef.current?.send({
        type: 'room.pitch',
        hz: series.userPitches.at(-1) ?? null,
        semitone: series.displaySemitones.at(-1) ?? null,
        similarity: series.similarities.at(-1) ?? 0,
        positionMs,
      });
    }, PITCH_INTERVAL_MS);

    const scoreTimer = setInterval(() => {
      const total = Math.round(localRef.current.score);

      if (total === sentScore.current) {
        return;
      }

      sentScore.current = total;
      socketRef.current?.send({ type: 'room.score', score: total });
    }, SCORE_INTERVAL_MS);

    const repaintTimer = setInterval(() => {
      setRemote(new Map(pending.current));
    }, REPAINT_INTERVAL_MS);

    return () => {
      clearInterval(alignTimer);
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

  const requestPause = useCallback(() => {
    socketRef.current?.send({ type: 'room.pause' });
  }, []);

  const requestResume = useCallback(() => {
    socketRef.current?.send({ type: 'room.resume' });
  }, []);

  const requestSeek = useCallback((time: number) => {
    socketRef.current?.send({
      type: 'room.seek',
      positionMs: Math.round(Math.max(0, time) * 1000),
    });
  }, []);

  const requestSkip = useCallback((kind: 'intro' | 'outro') => {
    if (kind === 'outro') {
      socketRef.current?.send({ type: 'room.skip_outro' });

      return;
    }

    socketRef.current?.send({
      type: 'room.skip_intro',
      positionMs: Math.round(Math.max(0, localRef.current.introTargetSec) * 1000),
    });
  }, []);

  const series = local.series;
  const setRoomPlayback = useSetRoomPlayback();

  // Publish the room as players so the mic layer (and therefore the HUD and the
  // graph) renders remote singers exactly like local-multiplayer ones.
  useEffect(() => {
    if (setRoomPlayback === null) {
      return;
    }

    if (room === null || roomState === null) {
      setRoomPlayback({ self: null, remote: new Map() });

      return;
    }

    const me = roomState.members.find((member) => member.id === room.memberId);

    setRoomPlayback({
      self: me === undefined ? null : { id: me.id, name: me.name, color: toRoomColor(me.color) },
      remote: new Map(
        roomState.members
          .filter((member) => member.id !== room.memberId)
          .map((member) => {
            const track = remote.get(member.id);
            const similarities = track?.similarities ?? [];

            return [
              member.id,
              {
                name: member.name,
                color: toRoomColor(member.color),
                host: member.host,
                score: member.score,
                series: {
                  // Placeholder references keep the remote trail on the same
                  // similarity-tinted render path as local multiplayer.
                  refPitches: similarities.map(() => 0),
                  userPitches: track?.pitches ?? [],
                  displaySemitones: track?.semitones ?? [],
                  similarities,
                  times: track?.times ?? [],
                  referenceTrack: null,
                  referenceTime: series.currentTime,
                  currentTime: series.currentTime,
                },
              },
            ] as const;
          }),
      ),
    });
  }, [room, roomState, remote, series, setRoomPlayback]);

  const derived = useMemo(() => deriveRoom(roomState, room), [room, roomState]);

  return useMemo(
    () => ({
      requestPause,
      requestResume,
      requestSeek,
      requestSkip,
      ...derived,
    }),
    [derived, requestPause, requestResume, requestSeek, requestSkip],
  );
};
