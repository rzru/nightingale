import { useCallback, useEffect } from 'react';

import { useNavInput } from '@/features/menu/hooks/use-nav-input';
import { usePlaybackConfigPersist } from '@/features/playback/hooks/use-playback-config-persist';
import {
  usePlaybackMicActions,
  usePlaybackMicState,
  usePlaybackThemeActions,
  usePlaybackTranscriptActions,
  usePlaybackTranscriptState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';
import type { AppConfig } from '@/types/AppConfig';

type KeyboardActions = {
  paused: boolean;
  guideVolume: number;
  guideAvailable: boolean;
  setGuideVolume: (volume: number) => void;
  persistConfig: (patch: Partial<AppConfig>) => void;
  handlePause: () => void;
  handleContinue: () => void;
  cycleTheme: () => void;
  cycleFlavor: () => void;
  handleToggleMic: () => void;
  handleCycleMic: () => void;
  handleToggleMicMonitor: () => void;
  multiplayer: boolean;
};

function handleGuideKey(key: string, actions: KeyboardActions): boolean {
  let next: number;
  if (key === 'g' || key === 'G') {
    next = actions.guideVolume > 0 ? 0 : 0.3;
  } else if (key === '=' || key === '+') {
    next = Math.min(1, actions.guideVolume + 0.1);
  } else if (key === '-') {
    next = Math.max(0, actions.guideVolume - 0.1);
  } else {
    return false;
  }

  if (actions.guideAvailable) {
    actions.setGuideVolume(next);
    actions.persistConfig({ guide_volume: next });
  }
  return true;
}

function handleKeyboardShortcut(event: KeyboardEvent, actions: KeyboardActions): void {
  if (event.key === ' ') {
    event.preventDefault();
    if (actions.paused) {
      actions.handleContinue();
    } else {
      actions.handlePause();
    }
    return;
  }
  if (actions.paused || handleGuideKey(event.key, actions)) {
    return;
  }

  if (actions.multiplayer && ['m', 'n'].includes(event.key.toLowerCase())) {
    return;
  }

  const shortcuts: Readonly<Record<string, () => void>> = {
    t: actions.cycleTheme,
    f: actions.cycleFlavor,
    m: actions.handleToggleMic,
    n: actions.handleCycleMic,
    r: actions.handleToggleMicMonitor,
  };
  shortcuts[event.key.toLowerCase()]?.();
}

/**
 * Wires keyboard + gamepad input for the playback session. Reads everything it
 * needs from the playback contexts; only the app config is passed in so we can
 * persist guide-volume changes without coupling this hook to the config query.
 */
export type PlaybackInputOverrides = {
  pause: () => void;
  resume: () => void;
  skipIntro: () => void;
  skipOutro: () => void;
};

/**
 * Wires keyboard + gamepad input for the playback session. Reads everything it
 * needs from the playback contexts; only the app config is passed in so we can
 * persist guide-volume changes without coupling this hook to the config query.
 * Room playback passes overrides so the same keys follow the room's rules.
 */
export function usePlaybackInput(
  config: AppConfig | null,
  enabled = true,
  overrides?: PlaybackInputOverrides,
) {
  const { paused, isReady, guideVolume, guideAvailable } = usePlaybackTransportState();
  const { getCurrentTime, setGuideVolume, handlePause, handleContinue } =
    usePlaybackTransportActions();
  const { cycleTheme, cycleFlavor } = usePlaybackThemeActions();
  const { firstSegmentStart, lastSegmentEnd, introSkipLeadSec } = usePlaybackTranscriptState();
  const { handleSkipIntro, handleSkipOutro } = usePlaybackTranscriptActions();
  const { handleToggleMic, handleCycleMic, handleToggleMicMonitor } = usePlaybackMicActions();
  const { multiplayer } = usePlaybackMicState();

  const persistConfig = usePlaybackConfigPersist(config);

  const pausedRef = useLatestRef(paused);
  const pauseRef = useLatestRef(overrides?.pause ?? handlePause);
  const resumeRef = useLatestRef(overrides?.resume ?? handleContinue);
  const skipIntroRef = useLatestRef(overrides?.skipIntro ?? handleSkipIntro);
  const skipOutroRef = useLatestRef(overrides?.skipOutro ?? handleSkipOutro);

  const pause = useCallback(() => pauseRef.current(), [pauseRef]);
  const resume = useCallback(() => resumeRef.current(), [resumeRef]);
  const skipIntro = useCallback(() => skipIntroRef.current(), [skipIntroRef]);
  const skipOutro = useCallback(() => skipOutroRef.current(), [skipOutroRef]);

  // Gamepad: nav.back = pause/resume, nav.confirm = skip intro/outro
  useNavInput(
    useCallback(
      (action) => {
        if (!enabled) {
          return;
        }
        if (action.back) {
          if (pausedRef.current) {
            resume();
          } else {
            pause();
          }
          return;
        }

        if (pausedRef.current) {
          return;
        }

        if (action.confirm) {
          if (!isReady) {
            return;
          }
          const t = getCurrentTime();
          if (t < firstSegmentStart - introSkipLeadSec) {
            skipIntro();
          } else if (t > lastSegmentEnd + 1) {
            skipOutro();
          }
        }
      },
      [
        enabled,
        pausedRef,
        pause,
        resume,
        isReady,
        getCurrentTime,
        firstSegmentStart,
        lastSegmentEnd,
        introSkipLeadSec,
        skipIntro,
        skipOutro,
      ],
    ),
  );

  // Keyboard-only shortcuts (G, T, F, M, N, R, +/-, Space)
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const actions: KeyboardActions = {
      paused,
      guideVolume,
      guideAvailable,
      setGuideVolume,
      persistConfig,
      handlePause: pause,
      handleContinue: resume,
      cycleTheme,
      cycleFlavor,
      handleToggleMic,
      handleCycleMic,
      handleToggleMicMonitor,
      multiplayer,
    };
    const onKeyDown = (event: KeyboardEvent) => handleKeyboardShortcut(event, actions);

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    enabled,
    paused,
    guideVolume,
    guideAvailable,
    setGuideVolume,
    cycleTheme,
    cycleFlavor,
    persistConfig,
    pause,
    resume,
    handleToggleMic,
    handleCycleMic,
    handleToggleMicMonitor,
    multiplayer,
  ]);
}
