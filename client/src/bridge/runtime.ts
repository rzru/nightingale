/**
 * Single source of truth for `invoke`/`listen`/`Channel` so the bridge layer
 * works identically in two transports:
 *  - Tauri: uses `@tauri-apps/api/core` + `/event` directly.
 *  - Web: posts JSON to `/api/cmd/<name>` and multiplexes events over a single
 *    `/ws` connection.
 *
 * Detection happens once at module-eval. Switching transports requires a full
 * page reload, which matches Tauri's existing semantics (no IPC hot-swap).
 */

import { Channel as TauriChannel, invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type EventCallback<T> = (event: { payload: T }) => void;

type InvokeArgs = Record<string, unknown> | undefined;

// ─── Web transport ──────────────────────────────────────────────────────────

/**
 * Web-side `Channel` lookalike. The Tauri `Channel` is used by mic capture to
 * stream high-rate PCM frames over IPC; the web build never crosses the
 * bridge for that path (the browser owns the mic), so this class only needs
 * to satisfy the type at construction time and not actually carry traffic.
 */
class WebChannel {
  onmessage: ((message: unknown) => void) | null = null;
}

const nativeCommands = new Set([
  'frontend_ready',
  'window_immersive',
  'minimize_window',
  'load_window_state',
  'track_window_state',
  'import_custom_background',
  'get_media_endpoint',
  'list_microphones',
  'start_mic_capture',
  'stop_mic_capture',
]);

const apiCall = async (name: string, args: InvokeArgs): Promise<unknown> => {
  const res = await fetch(`/api/cmd/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args ?? {}),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(body || `HTTP ${res.status}`);
  }

  if (res.status === 204) {
    return undefined;
  }

  const body: unknown = await res.json();
  return body;
};

type WsEnvelope = {
  type: string;
  payload?: unknown;
};

type WsListener = (payload: unknown) => void;

let socket: WebSocket | null = null;
let connecting: Promise<WebSocket> | null = null;
const wsListeners = new Map<string, Set<WsListener>>();

const wsUrl = (): string => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  return `${proto}//${window.location.host}/ws`;
};

function parseWsEnvelope(data: unknown): WsEnvelope | null {
  let parsed: unknown;

  try {
    parsed = typeof data === 'string' ? JSON.parse(data) : null;
  } catch {
    return null;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('type' in parsed) ||
    typeof parsed.type !== 'string'
  ) {
    return null;
  }

  return {
    type: parsed.type,
    payload: 'payload' in parsed ? parsed.payload : undefined,
  };
}

function dispatchWsMessage(message: MessageEvent<unknown>): void {
  const envelope = parseWsEnvelope(message.data);
  if (!envelope) {
    return;
  }

  const subscribers = wsListeners.get(envelope.type);
  if (!subscribers) {
    return;
  }

  for (const fn of subscribers) {
    try {
      fn(envelope.payload);
    } catch {
      // Listeners must not break the fan-out loop.
    }
  }
}

const ensureSocket = (): Promise<WebSocket> => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    return Promise.resolve(socket);
  }

  if (connecting) {
    return connecting;
  }

  connecting = new Promise((resolve, reject) => {
    const next = new WebSocket(wsUrl());

    next.addEventListener('open', () => {
      socket = next;
      connecting = null;
      resolve(next);
    });

    next.addEventListener('error', (error) => {
      connecting = null;
      reject(error);
    });

    next.addEventListener('close', () => {
      if (socket === next) {
        socket = null;
      }
    });

    next.addEventListener('message', dispatchWsMessage);
  });

  return connecting;
};

const webListen = async (event: string, cb: EventCallback<unknown>): Promise<UnlistenFn> => {
  // Wait for the WS to actually open before resolving. Server-side events go
  // out over a `tokio::broadcast` channel that only delivers to clients with
  // an active outbound task, so anything emitted before this socket finishes
  // its handshake is gone forever. Awaiting here lets call sites do
  // `await listen(...); invoke(...)` and trust that the invoke can't race
  // ahead of the subscription. Failures fall through so the listener is still
  // registered for a later reconnect attempt.
  try {
    await ensureSocket();
  } catch {
    // Server might be down momentarily; the next attempt re-opens.
  }

  let subscribers = wsListeners.get(event);

  if (!subscribers) {
    subscribers = new Set();
    wsListeners.set(event, subscribers);
  }

  const wrapped: WsListener = (payload) => cb({ payload });

  subscribers.add(wrapped);

  return () => {
    const set = wsListeners.get(event);

    set?.delete(wrapped);

    if (set && set.size === 0) {
      wsListeners.delete(event);
    }
  };
};

// ─── Exports ────────────────────────────────────────────────────────────────

export function invoke<T>(name: string, args?: InvokeArgs): Promise<T>;
export function invoke(name: string, args?: InvokeArgs): Promise<unknown> {
  if (!isTauri) {
    return apiCall(name, args);
  }
  if (nativeCommands.has(name)) {
    return tauriInvoke(name, args);
  }
  return tauriInvoke('dispatch_command', { name, payload: args ?? {} });
}

export function listen<T>(event: string, cb: EventCallback<T>): Promise<UnlistenFn>;
export function listen(event: string, cb: EventCallback<unknown>): Promise<UnlistenFn> {
  return isTauri ? tauriListen(event, cb) : webListen(event, cb);
}

export type RuntimeChannel<T> = { onmessage: ((message: T) => void) | null };

export function createChannel<T>(): RuntimeChannel<T> {
  return isTauri ? new TauriChannel<T>() : new WebChannel();
}

export type { UnlistenFn };
