/**
 * Classic playback reads the song from location state. Session playback loads
 * shared state when the same route has the `session` query flag.
 */

import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router';

import {
  isSessionPlayback,
  loadPlaybackSession,
  onPlaybackSessionChanged,
  type PlaybackSession,
} from '@/bridge/playback-session';
import { playbackLocationStateSchema } from '@/bridge/schemas';
import { useConfig } from '@/shared/config/use-config';

import { PlaybackInner } from './playback-inner';

function PlaybackSessionView({
  session,
  sessionPlayback,
}: {
  session: PlaybackSession;
  sessionPlayback: boolean;
}) {
  const { data: config } = useConfig();

  return (
    <PlaybackInner
      key={session.playbackId ?? session.song.file_hash}
      song={session.song}
      config={config ?? null}
      queuePlayback={session.queuePlayback}
      sessionPlayback={sessionPlayback}
      players={session.players}
      room={session.room}
    />
  );
}

export const Playback = () => {
  const location = useLocation();
  if (isSessionPlayback()) {
    return <SessionPlayback />;
  }
  const state: unknown = location.state;
  const parsedState = playbackLocationStateSchema.safeParse(state);

  if (!parsedState.success) {
    return <Navigate to="/" replace />;
  }

  // Spread the parsed session: rebuilding it field by field has already
  // dropped `room` once, which silently turned room playback into solo.
  const session: PlaybackSession = {
    ...parsedState.data,
    queuePlayback: parsedState.data.queuePlayback ?? false,
  };

  return <PlaybackSessionView session={session} sessionPlayback={false} />;
};

const SessionPlayback = () => {
  const [session, setSession] = useState<PlaybackSession | null>();

  useEffect(() => {
    const lifecycle = { cancelled: false };
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const stop = await onPlaybackSessionChanged(setSession);
        if (lifecycle.cancelled) {
          stop();
          return;
        }
        unlisten = stop;
        setSession(await loadPlaybackSession());
      } catch {
        setSession(null);
      }
    })();

    return () => {
      lifecycle.cancelled = true;
      unlisten?.();
    };
  }, []);

  if (session === undefined) {
    return null;
  }
  if (session === null) {
    return <Navigate to="/" replace />;
  }
  return <PlaybackSessionView session={session} sessionPlayback />;
};
