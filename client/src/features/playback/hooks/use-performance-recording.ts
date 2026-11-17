import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  beginRecording,
  cancelRecording,
  endRecording,
  holdRecording,
  markRecording,
  recordingSupported,
} from '@/bridge/recording';
import type { TimeSubscriber } from '@/features/playback/hooks/use-audio-player';
import { t } from '@/i18n';

/** A jump of the playhead larger than this is a seek, not playback. */
const SEEK_JUMP_SEC = 0.5;

type RecordingInput = {
  /** Recording switched on in the settings. */
  enabled: boolean;
  captureId: string;
  /** The song is playing, not paused. */
  playing: boolean;
  micReady: boolean;
  subscribe: (fn: TimeSubscriber) => () => void;
  getCurrentTime: () => number;
};

const reportFailure = (cause: unknown) => {
  toast.error(
    t('playback.recording.failed', {
      error: cause instanceof Error ? cause.message : String(cause),
    }),
  );
};

/**
 * Records the singer's voice while the song plays. Every start, resume and
 * seek opens a new segment at the current song time, so a part sung again
 * after seeking back replaces the earlier take of it.
 */
export function usePerformanceRecording({
  enabled,
  captureId,
  playing,
  micReady,
  subscribe,
  getCurrentTime,
}: RecordingInput) {
  const active = enabled && recordingSupported;
  const live = playing && micReady;
  const [recording, setRecording] = useState(false);
  const begunRef = useRef(false);
  const failedRef = useRef(false);
  const lastTimeRef = useRef<number | null>(null);

  // Arm once per song, then follow play and pause.
  useEffect(() => {
    if (!active || failedRef.current) {
      return;
    }
    if (!live) {
      if (begunRef.current) {
        setRecording(false);
        void holdRecording().catch(reportFailure);
      }
      lastTimeRef.current = null;
      return;
    }
    void (async () => {
      try {
        if (!begunRef.current) {
          begunRef.current = true;
          await beginRecording(captureId);
        }
        const now = getCurrentTime();
        lastTimeRef.current = now;
        await markRecording(now);
        setRecording(true);
      } catch (cause) {
        failedRef.current = true;
        setRecording(false);
        reportFailure(cause);
      }
    })();
  }, [active, captureId, getCurrentTime, live]);

  // Seeks while playing start a new segment at the new position.
  useEffect(() => {
    if (!active || !live) {
      return undefined;
    }
    return subscribe((time) => {
      const last = lastTimeRef.current;
      lastTimeRef.current = time;
      if (last !== null && (time < last || time - last > SEEK_JUMP_SEC)) {
        void markRecording(time).catch(reportFailure);
      }
    });
  }, [active, live, subscribe]);

  // Leaving the song without finishing keeps no voice on disk.
  useEffect(
    () => () => {
      if (begunRef.current) {
        void cancelRecording().catch(() => {});
      }
    },
    [],
  );

  /** End the take; its folder, or `null` when nothing was recorded. */
  const finish = useCallback(async (): Promise<string | null> => {
    if (!begunRef.current) {
      return null;
    }
    begunRef.current = false;
    setRecording(false);
    try {
      return await endRecording();
    } catch (cause) {
      reportFailure(cause);
      return null;
    }
  }, []);

  return { recording, finish };
}
