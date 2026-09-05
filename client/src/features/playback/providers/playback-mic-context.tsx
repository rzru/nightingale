/**
 * Owns everything mic-shaped during playback: device selection, pitch capture,
 * monitor toggle, reactive shader uniforms, and the pitch-scoring series/score.
 *
 * Reads playback state (isReady, isPlaying, paused) from the transport context
 * to gate hardware capture, and persists user toggles to the app config.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';

import { useMicCapture, useMicPitch } from '@/features/microphone/hooks/use-mic-pitch';
import { useMicReactive, type MicReactiveRef } from '@/features/microphone/hooks/use-mic-reactive';
import { useMicDevices } from '@/features/microphone/queries/use-mic-devices';
import { usePitchScoring } from '@/features/playback/hooks/use-pitch-scoring';
import { usePlaybackConfigPersist } from '@/features/playback/hooks/use-playback-config-persist';
import { DEFAULT_MIC_LATENCY_COMPENSATION_SEC } from '@/features/playback/lib/pitch/constants';
import type { PitchSeries } from '@/features/playback/lib/pitch/state';
import type { AppConfig } from '@/types/AppConfig';

import {
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from './playback-transport-context';

export type PlaybackMicState = {
  micUserEnabled: boolean;
  micMonitorUserEnabled: boolean;
  selectedMicId: string | null;
  micName: string;
  pitchScore: number | null;
  rawScore: number;
  series: PitchSeries;
  micCaptureActive: boolean;
  micPitchActive: boolean;
  micReady: boolean;
  micCaptureError: string | null;
};

export type PlaybackMicActions = {
  reactiveRef: MicReactiveRef;
  handleToggleMic: () => void;
  handleCycleMic: () => void;
  handleToggleMicMonitor: () => void;
  setRecordingCaptureRequested: (requested: boolean) => void;
};

const MicStateContext = createContext<PlaybackMicState | null>(null);
const MicActionsContext = createContext<PlaybackMicActions | null>(null);

type PlaybackMicProviderProps = {
  config: AppConfig | null;
  children: ReactNode;
};

type CaptureStateInput = {
  isReady: boolean;
  isPlaying: boolean;
  paused: boolean;
  micEnabled: boolean;
  monitorEnabled: boolean;
  recordingRequested: boolean;
};

const captureState = (input: CaptureStateInput) => {
  const playbackActive = input.isReady && input.isPlaying && !input.paused;
  const micPitchEnabled = playbackActive && input.micEnabled;
  const micMonitorEnabled = input.monitorEnabled;

  return {
    micPitchEnabled,
    micMonitorEnabled,
    captureEnabled: micPitchEnabled || micMonitorEnabled || input.recordingRequested,
  };
};

const latencyCompensation = (config: AppConfig | null): number =>
  config?.mic_latency_compensation_sec ?? DEFAULT_MIC_LATENCY_COMPENSATION_SEC;

export function PlaybackMicProvider({ config, children }: PlaybackMicProviderProps) {
  const { isReady, isPlaying, paused, duration } = usePlaybackTransportState();
  const { subscribe, getScoringBuffer } = usePlaybackTransportActions();

  const persistConfig = usePlaybackConfigPersist(config);

  const [micUserEnabled, setMicUserEnabled] = useState(config?.mic_active ?? true);
  const [micMonitorUserEnabled, setMicMonitorUserEnabled] = useState(
    config?.mic_monitoring ?? false,
  );
  const [selectedMicId, setSelectedMicId] = useState<string | null>(config?.preferred_mic ?? null);
  const [recordingCaptureRequested, setRecordingCaptureRequested] = useState(false);

  const micDevices = useMicDevices();

  const { micPitchEnabled, micMonitorEnabled, captureEnabled } = captureState({
    isReady,
    isPlaying,
    paused,
    micEnabled: micUserEnabled,
    monitorEnabled: micMonitorUserEnabled,
    recordingRequested: recordingCaptureRequested,
  });

  const captureOptions = useMemo(() => ({ emit_audio: micMonitorEnabled }), [micMonitorEnabled]);

  const { active: micCaptureActive, error: micCaptureError } = useMicCapture(
    selectedMicId,
    captureEnabled,
    captureOptions,
  );
  const {
    latestPitch,
    active: micPitchActive,
    error: micPitchError,
  } = useMicPitch(micPitchEnabled);
  const reactiveRef = useMicReactive(micPitchEnabled);

  const { series, score } = usePitchScoring(
    { isReady, duration, getReferenceBuffer: getScoringBuffer, subscribe },
    latestPitch,
    latencyCompensation(config),
  );

  const micErrorShown = useRef(false);
  useEffect(() => {
    const micError = micCaptureError ?? micPitchError;
    if (typeof micError === 'string' && micError !== '' && !micErrorShown.current) {
      micErrorShown.current = true;
      toast.error(`Microphone: ${micError}`);
    }
    if (typeof micError !== 'string' || micError === '') {
      micErrorShown.current = false;
    }
  }, [micCaptureError, micPitchError]);

  const handleToggleMic = useCallback(() => {
    setMicUserEnabled((prev) => {
      const next = !prev;
      if (!next && micMonitorUserEnabled) {
        setMicMonitorUserEnabled(false);
        persistConfig({ mic_active: false, mic_monitoring: false });
      } else {
        persistConfig({ mic_active: next });
      }
      return next;
    });
  }, [persistConfig, micMonitorUserEnabled]);

  const handleCycleMic = useCallback(() => {
    if (micDevices.length <= 1) {
      return;
    }
    const currentIdx = micDevices.findIndex((d) => d.deviceId === selectedMicId);
    const nextIdx = (currentIdx + 1) % micDevices.length;
    const next = micDevices[nextIdx];
    setSelectedMicId(next.deviceId);
    persistConfig({ preferred_mic: next.deviceId });
  }, [micDevices, selectedMicId, persistConfig]);

  const handleToggleMicMonitor = useCallback(() => {
    setMicMonitorUserEnabled((prev) => {
      const next = !prev;
      persistConfig({ mic_monitoring: next });
      if (next && !micUserEnabled) {
        setMicUserEnabled(true);
        persistConfig({ mic_active: true });
      }
      return next;
    });
  }, [persistConfig, micUserEnabled]);

  const stateValue = useMemo<PlaybackMicState>(() => {
    const micReady = micCaptureActive && micPitchActive && micUserEnabled;
    const selectedMic = micDevices.find((device) => device.deviceId === selectedMicId);
    return {
      micUserEnabled,
      micMonitorUserEnabled,
      selectedMicId,
      micName: selectedMic?.label ?? selectedMicId ?? 'Default',
      pitchScore: micReady ? score : null,
      rawScore: score,
      series,
      micCaptureActive,
      micPitchActive,
      micReady,
      micCaptureError,
    };
  }, [
    micUserEnabled,
    micMonitorUserEnabled,
    selectedMicId,
    score,
    series,
    micCaptureActive,
    micPitchActive,
    micDevices,
    micCaptureError,
  ]);

  const actionsValue = useMemo<PlaybackMicActions>(
    () => ({
      reactiveRef,
      handleToggleMic,
      handleCycleMic,
      handleToggleMicMonitor,
      setRecordingCaptureRequested,
    }),
    [
      reactiveRef,
      handleToggleMic,
      handleCycleMic,
      handleToggleMicMonitor,
      setRecordingCaptureRequested,
    ],
  );

  return (
    <MicStateContext.Provider value={stateValue}>
      <MicActionsContext.Provider value={actionsValue}>{children}</MicActionsContext.Provider>
    </MicStateContext.Provider>
  );
}

export function usePlaybackMicState(): PlaybackMicState {
  const ctx = useContext(MicStateContext);
  if (!ctx) {
    throw new Error('usePlaybackMicState must be used within a PlaybackMicProvider');
  }
  return ctx;
}

export function usePlaybackMicActions(): PlaybackMicActions {
  const ctx = useContext(MicActionsContext);
  if (!ctx) {
    throw new Error('usePlaybackMicActions must be used within a PlaybackMicProvider');
  }
  return ctx;
}
