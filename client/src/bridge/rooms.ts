import { z } from 'zod';

/**
 * Client half of the node protocol. The node lives in `node/src/proto.rs`; both
 * sides are expected to change together, which is what `PROTOCOL` guards.
 */
export const ROOMS_PROTOCOL = 1;

/**
 * Trust boundary. A node is an untrusted peer: everything it sends is capped
 * before it reaches the UI, the audio engine, or the graph renderer.
 */
const MAX_NAME = 32;
const MAX_ROOM_NAME = 60;
const MAX_TITLE = 120;
const MAX_ID = 64;
const MAX_MEMBERS = 4;
const MAX_ROOMS = 50;
const MAX_DIRECTORY = 100;
const MAX_SCORE = 1_000_000;
const MIN_HZ = 20;
const MAX_HZ = 5000;
/** A real node frame is a few hundred bytes; anything larger is dropped. */
const MAX_FRAME_BYTES = 64 * 1024;
const MAX_FRAMES_PER_SECOND = 120;
/** Clock offsets beyond this are noise or a lie, not a measurement. */
const MAX_CLOCK_OFFSET_MS = 5000;
const MAX_POSITION_MS = 24 * 60 * 60 * 1000;
const STATE_COALESCE_MS = 33;

const label = (max: number) => z.string().max(max);

/**
 * Shared node directory. Served from GitHub raw because that host answers with
 * `Access-Control-Allow-Origin: *`; the copy on the project site is for humans
 * and would be blocked in the self-hosted web build.
 */
export const NODE_DIRECTORY_URL =
  'https://raw.githubusercontent.com/rzru/nightingale/master/site/public/instances.json';

const countSchema = z.object({ used: z.number(), capacity: z.number() });

export const nodeInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  protocol: z.number(),
  public: z.boolean(),
  rooms: countSchema,
  slots: countSchema,
  uptimeS: z.number(),
});

export type NodeInfo = z.infer<typeof nodeInfoSchema>;

const phaseSchema = z.enum(['lobby', 'arming', 'playing']);

export const roomTrackSchema = z.object({
  hash: label(MAX_ID),
  title: label(MAX_TITLE),
});

export type RoomTrack = z.infer<typeof roomTrackSchema>;

export const playerColorSchema = z.enum(['rose', 'fuchsia', 'amber', 'emerald']);

export type RoomColor = z.infer<typeof playerColorSchema>;

/** Payloads carry colours as plain strings; anything unknown falls back. */
export const toRoomColor = (value: string): RoomColor =>
  playerColorSchema.catch('rose').parse(value);

export const roomMemberSchema = z.object({
  id: label(MAX_ID),
  name: label(MAX_NAME),
  ready: z.boolean(),
  hasTrack: z.boolean(),
  loaded: z.boolean(),
  score: z.number().min(0).max(MAX_SCORE),
  songs: z.number().min(0),
  total: z.number().min(0),
  host: z.boolean(),
  color: playerColorSchema,
});

export type RoomMember = z.infer<typeof roomMemberSchema>;

export const roomViewSchema = z.object({
  id: label(MAX_ID),
  name: label(MAX_ROOM_NAME),
  hostId: label(MAX_ID),
  members: z.array(roomMemberSchema).max(MAX_MEMBERS),
  capacity: z.number().min(1).max(MAX_MEMBERS),
  track: roomTrackSchema.nullable(),
  phase: phaseSchema,
  startAtMs: z.number().nullable(),
  startPositionMs: z.number().min(0).max(MAX_POSITION_MS),
  paused: z.boolean(),
  pausedBy: label(MAX_NAME).nullable(),
  pausedById: label(MAX_ID).nullable(),
  positionMs: z.number().min(0),
  locked: z.boolean(),
});

export type RoomView = z.infer<typeof roomViewSchema>;

export const roomSummarySchema = z.object({
  id: label(MAX_ID),
  name: label(MAX_ROOM_NAME),
  hostName: label(MAX_NAME),
  members: z.number().min(0).max(MAX_MEMBERS),
  capacity: z.number().min(1).max(MAX_MEMBERS),
  ready: z.number().min(0).max(MAX_MEMBERS),
  phase: phaseSchema,
  trackTitle: label(MAX_TITLE).nullable(),
  // Older nodes omit it; the app then falls back to the node's own label.
  trackHash: label(MAX_ID).nullable().optional(),
  locked: z.boolean(),
});

export type RoomSummary = z.infer<typeof roomSummarySchema>;

const joiningSchema = z.object({
  roomId: label(MAX_ID),
  memberId: label(MAX_ID),
  token: label(MAX_ID),
});

export type Joining = z.infer<typeof joiningSchema>;

const errorSchema = z.object({ reason: label(MAX_ID) });

const directorySchema = z.array(
  z.object({ url: z.string(), name: label(MAX_NAME).optional() }).catchall(z.unknown()),
);

export type NodeDirectoryEntry = { url: string; name: string | null };

export const roomEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('room.state'), state: roomViewSchema }),
  z.object({
    type: z.literal('room.pitch'),
    memberId: label(MAX_ID),
    hz: z.number().min(MIN_HZ).max(MAX_HZ).nullable(),
    semitone: z.number().min(0).max(144).nullable(),
    similarity: z.number().min(0).max(1),
    positionMs: z.number().min(0).max(MAX_POSITION_MS),
  }),
  z.object({ type: z.literal('room.deny'), reason: label(MAX_ID) }),
  z.object({ type: z.literal('room.closed'), reason: label(MAX_ID) }),
  z.object({
    type: z.literal('room.skip'),
    kind: z.enum(['intro', 'outro']),
    positionMs: z.number().min(0),
  }),
  z.object({
    type: z.literal('time.pong'),
    clientMs: z.number().min(0),
    serverMs: z.number().min(0),
  }),
]);

export type RoomEvent = z.infer<typeof roomEventSchema>;

export type RoomClientFrame =
  | { type: 'room.ready'; ready: boolean }
  | { type: 'room.has_track'; hasTrack: boolean }
  | { type: 'room.track'; hash: string; title: string }
  | { type: 'room.leave' }
  | { type: 'room.color'; color: RoomColor }
  | { type: 'room.loaded' }
  | { type: 'room.pause' }
  | { type: 'room.resume' }
  | { type: 'room.skip_intro'; positionMs: number }
  | { type: 'room.skip_outro' }
  | { type: 'room.seek'; positionMs: number }
  | { type: 'room.start' }
  | { type: 'room.end' }
  | {
      type: 'room.pitch';
      hz: number | null;
      semitone: number | null;
      similarity: number;
      positionMs: number;
    }
  | { type: 'room.score'; score: number }
  | { type: 'time.ping'; clientMs: number };

/** A node refused the request; `reason` mirrors `RoomError::reason()`. */
export class RoomRequestError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

export type NodeProbe = {
  info: NodeInfo | null;
  rttMs: number | null;
  url: string;
};

/** Accepts bare hosts and paths; returns an origin-with-path without a trailing slash. */
export const normalizeNodeUrl = (input: string): string | null => {
  const trimmed = input.trim();

  if (trimmed === '') {
    return null;
  }

  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const path = url.pathname.replace(/\/+$/, '');

    return `${url.origin}${path}`;
  } catch {
    return null;
  }
};

const request = async (url: string, init?: RequestInit): Promise<unknown> => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const parsed = errorSchema.safeParse(body);

    throw new RoomRequestError(parsed.success ? parsed.data.reason : `http-${response.status}`);
  }

  return await response.json();
};

export const loadNodeDirectory = async (): Promise<NodeDirectoryEntry[]> => {
  try {
    const response = await fetch(NODE_DIRECTORY_URL, { signal: AbortSignal.timeout(8000) });

    if (!response.ok) {
      return [];
    }

    const parsed = directorySchema.safeParse(await response.json());

    if (!parsed.success) {
      return [];
    }

    const seen = new Set<string>();
    const entries: NodeDirectoryEntry[] = [];

    for (const entry of parsed.data) {
      const url = normalizeNodeUrl(entry.url);

      // The list is community-edited, so it admits only TLS nodes: a plaintext
      // node in a shared list would hand room passwords to the network.
      if (url === null || !url.startsWith('https://') || seen.has(url)) {
        continue;
      }

      seen.add(url);
      entries.push({ url, name: entry.name ?? null });

      if (entries.length >= MAX_DIRECTORY) {
        break;
      }
    }

    return entries;
  } catch {
    return [];
  }
};

/** One timed `GET /api/node`; that round trip is the ping shown in the node list. */
export const probeNode = async (url: string): Promise<NodeProbe> => {
  const started = performance.now();

  try {
    const response = await fetch(`${url}/api/node`, { signal: AbortSignal.timeout(4000) });
    const rttMs = Math.round(performance.now() - started);

    if (!response.ok) {
      return { url, info: null, rttMs: null };
    }

    const parsed = nodeInfoSchema.safeParse(await response.json());

    return parsed.success ? { url, info: parsed.data, rttMs } : { url, info: null, rttMs: null };
  } catch {
    return { url, info: null, rttMs: null };
  }
};

export const loadRooms = async (nodeUrl: string): Promise<RoomSummary[]> => {
  const body = await request(`${nodeUrl}/api/rooms`);

  return z.array(roomSummarySchema).max(MAX_ROOMS).parse(body);
};

export const createRoom = async (
  nodeUrl: string,
  input: { name: string; hostName: string; password: string | null },
): Promise<Joining> => {
  const body = await request(`${nodeUrl}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  return joiningSchema.parse(body);
};

export const joinRoom = async (
  nodeUrl: string,
  roomId: string,
  input: { name: string; password: string | null },
): Promise<Joining> => {
  const body = await request(`${nodeUrl}/api/rooms/${encodeURIComponent(roomId)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  return joiningSchema.parse(body);
};

const socketUrl = (nodeUrl: string, joining: Joining): string => {
  const url = new URL(`${nodeUrl}/ws`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('room', joining.roomId);
  url.searchParams.set('token', joining.token);

  return url.toString();
};

const median = (values: number[]): number => {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const PING_SAMPLES = 4;
const PING_SPACING_MS = 250;

export type RoomSocketHandlers = {
  /** Median `server - client` clock offset, in milliseconds. */
  onClock: (offsetMs: number) => void;
  onClose: () => void;
  onEvent: (event: RoomEvent) => void;
};

export type RoomSocket = {
  close: () => void;
  /** Drops the seat now instead of after the node's grace window. */
  leave: () => void;
  send: (frame: RoomClientFrame) => void;
};

export const openRoomSocket = (
  nodeUrl: string,
  joining: Joining,
  handlers: RoomSocketHandlers,
): RoomSocket => {
  const socket = new WebSocket(socketUrl(nodeUrl, joining));
  const offsets: number[] = [];
  let offset = 0;
  let pings = 0;
  let pingTimer: ReturnType<typeof setTimeout> | null = null;
  // Token bucket: a hostile node cannot turn frames into a render storm.
  let tokens = MAX_FRAMES_PER_SECOND;
  let lastRefill = performance.now();
  let pendingState: RoomEvent | null = null;
  let stateTimer: ReturnType<typeof setTimeout> | null = null;

  const flushState = () => {
    stateTimer = null;
    const next = pendingState;
    pendingState = null;

    if (next !== null) {
      handlers.onEvent(next);
    }
  };

  const send = (frame: RoomClientFrame) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(frame));
    }
  };

  const ping = () => {
    send({ type: 'time.ping', clientMs: Date.now() });
    pings += 1;

    if (pings < PING_SAMPLES) {
      pingTimer = setTimeout(ping, PING_SPACING_MS);
    }
  };

  socket.addEventListener('open', () => {
    ping();
  });

  socket.addEventListener('message', (message: MessageEvent) => {
    const text = String(message.data);

    if (text.length > MAX_FRAME_BYTES) {
      return;
    }

    const now = performance.now();
    tokens = Math.min(
      MAX_FRAMES_PER_SECOND,
      tokens + ((now - lastRefill) / 1000) * MAX_FRAMES_PER_SECOND,
    );
    lastRefill = now;

    if (tokens < 1) {
      return;
    }

    tokens -= 1;

    let payload: unknown;

    try {
      payload = JSON.parse(text);
    } catch {
      return;
    }

    const parsed = roomEventSchema.safeParse(payload);

    if (!parsed.success) {
      return;
    }

    if (parsed.data.type === 'time.pong') {
      const receivedAt = Date.now();
      const measured = parsed.data.serverMs - (parsed.data.clientMs + receivedAt) / 2;

      if (Math.abs(measured) <= MAX_CLOCK_OFFSET_MS) {
        offsets.push(measured);
        offset = Math.round(median(offsets));
        handlers.onClock(offset);
      }

      return;
    }

    if (parsed.data.type === 'room.state') {
      pendingState = parsed.data;

      if (stateTimer === null) {
        stateTimer = setTimeout(flushState, STATE_COALESCE_MS);
      }

      return;
    }

    handlers.onEvent(parsed.data);
  });

  socket.addEventListener('close', () => {
    if (pingTimer !== null) {
      clearTimeout(pingTimer);
      pingTimer = null;
    }

    if (stateTimer !== null) {
      clearTimeout(stateTimer);
      stateTimer = null;
    }

    handlers.onClose();
  });

  return {
    send,
    close: () => {
      socket.close();
    },
    leave: () => {
      send({ type: 'room.leave' });
      socket.close();
    },
  };
};
