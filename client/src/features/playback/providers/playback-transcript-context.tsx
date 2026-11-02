/**
 * Owns the transcript for the active song, the derived skip-intro / skip-outro
 * boundaries, and the handlers that act on them.
 *
 * Skip-outro is a two-step flow: pause the audio engine, then flag the
 * playback result handler to fall through to the result dialog.  That pending
 * flag lives here so the rest of the tree can subscribe to it without a
 * separate piece of useState wiring.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import { usePlaybackTranscript } from '@/features/playback/hooks/use-playback-transcript';
import { usePlaybackTransportActions } from '@/features/playback/providers/playback-transport-context';
import { INTRO_SKIP_LEAD_SEC } from '@/features/playback/utils/transcript-segments';
import type { Segment } from '@/types/Transcript';

export type PlaybackTranscriptState = {
  segments: Segment[];
  transcriptSource: string;
  firstSegmentStart: number;
  lastSegmentEnd: number;
  introSkipLeadSec: number;
  skipOutroPending: boolean;
  isReady: boolean;
};

export type PlaybackTranscriptActions = {
  handleSkipIntro: () => void;
  handleSkipOutro: () => void;
  clearSkipOutroPending: () => void;
};

const TranscriptStateContext = createContext<PlaybackTranscriptState | null>(null);
const TranscriptActionsContext = createContext<PlaybackTranscriptActions | null>(null);

type PlaybackTranscriptProviderProps = {
  fileHash: string;
  children: ReactNode;
};

export function PlaybackTranscriptProvider({
  fileHash,
  children,
}: PlaybackTranscriptProviderProps) {
  const navigate = useNavigate();
  const { seek, pauseAudio } = usePlaybackTransportActions();
  const { segments, transcriptSource, isReady, error } = usePlaybackTranscript(fileHash);
  const [skipOutroPending, setSkipOutroPending] = useState(false);

  useEffect(() => {
    if (error !== null) {
      toast.error(error);
      void navigate('/', { replace: true });
    }
  }, [error, navigate]);

  const firstSegmentStart = segments.length > 0 ? segments[0].start : 0;
  const lastSegmentEnd = segments.length > 0 ? segments[segments.length - 1].end : 0;

  const handleSkipIntro = useCallback(() => {
    if (segments.length === 0) {
      return;
    }
    const target = Math.max(0, firstSegmentStart - INTRO_SKIP_LEAD_SEC);
    seek(target);
  }, [seek, firstSegmentStart, segments.length]);

  const handleSkipOutro = useCallback(() => {
    // Pause the audio engine WITHOUT raising the user-facing `paused` flag,
    // otherwise PauseOverlay would flash open when the result dialog closes.
    pauseAudio();
    setSkipOutroPending(true);
  }, [pauseAudio]);

  const clearSkipOutroPending = useCallback(() => {
    setSkipOutroPending(false);
  }, []);

  const stateValue = useMemo<PlaybackTranscriptState>(
    () => ({
      segments,
      transcriptSource,
      firstSegmentStart,
      lastSegmentEnd,
      introSkipLeadSec: INTRO_SKIP_LEAD_SEC,
      skipOutroPending,
      isReady,
    }),
    [segments, transcriptSource, firstSegmentStart, lastSegmentEnd, skipOutroPending, isReady],
  );

  const actionsValue = useMemo<PlaybackTranscriptActions>(
    () => ({
      handleSkipIntro,
      handleSkipOutro,
      clearSkipOutroPending,
    }),
    [handleSkipIntro, handleSkipOutro, clearSkipOutroPending],
  );

  return (
    <TranscriptStateContext.Provider value={stateValue}>
      <TranscriptActionsContext.Provider value={actionsValue}>
        {children}
      </TranscriptActionsContext.Provider>
    </TranscriptStateContext.Provider>
  );
}

export function usePlaybackTranscriptState(): PlaybackTranscriptState {
  const ctx = useContext(TranscriptStateContext);
  if (!ctx) {
    throw new Error('usePlaybackTranscriptState must be used within a PlaybackTranscriptProvider');
  }
  return ctx;
}

export function usePlaybackTranscriptActions(): PlaybackTranscriptActions {
  const ctx = useContext(TranscriptActionsContext);
  if (!ctx) {
    throw new Error(
      'usePlaybackTranscriptActions must be used within a PlaybackTranscriptProvider',
    );
  }
  return ctx;
}
