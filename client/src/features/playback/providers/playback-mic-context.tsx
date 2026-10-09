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

import type { PlaybackPlayer } from '@/bridge/playback-session';
import { useMicCapture, useMicPitch } from '@/features/microphone/hooks/use-mic-pitch';
import { useMicReactive, type MicReactiveRef } from '@/features/microphone/hooks/use-mic-reactive';
import { useMicDevices, type MicDevice } from '@/features/microphone/queries/use-mic-devices';
import {
  usePitchScoring,
  type PitchScoringSource,
} from '@/features/playback/hooks/use-pitch-scoring';
import { usePlaybackConfigPersist } from '@/features/playback/hooks/use-playback-config-persist';
import { DEFAULT_MIC_LATENCY_COMPENSATION_SEC } from '@/features/playback/lib/pitch/constants';
import type { PitchSeries } from '@/features/playback/lib/pitch/state';
import type { AppConfig } from '@/types/AppConfig';

import {
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from './playback-transport-context';

export type PlaybackPlayerMicState = {
  id: string;
  profile: string | null;
  microphoneId: string | null;
  micName: string;
  pitchScore: number | null;
  rawScore: number;
  series: PitchSeries;
  micCaptureActive: boolean;
  micPitchActive: boolean;
  micReady: boolean;
  error: string | null;
};

export type PlaybackMicState = {
  multiplayer: boolean;
  players: PlaybackPlayerMicState[];
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
};

export type PlaybackMicActions = {
  reactiveRef: MicReactiveRef;
  handleToggleMic: () => void;
  handleCycleMic: () => void;
  handleToggleMicMonitor: () => void;
};

const EMPTY_PLAYERS: readonly PlaybackPlayer[] = [];
const MicStateContext = createContext<PlaybackMicState | null>(null);
const MicActionsContext = createContext<PlaybackMicActions | null>(null);

type PlaybackMicProviderProps = {
  config: AppConfig | null;
  players?: readonly PlaybackPlayer[];
  children: ReactNode;
};

type MicPlayerConfig = {
  present: boolean;
  id: string;
  profile: string | null;
  microphoneId: string | null;
};

type InternalPlayerMicState = PlaybackPlayerMicState & { present: boolean };

type PlayerMicInput = {
  player: MicPlayerConfig;
  captureEnabled: boolean;
  pitchEnabled: boolean;
  emitAudio: boolean;
  source: PitchScoringSource;
  latencySec: number;
};

type CaptureSettings = {
  captureEnabled: boolean;
  pitchEnabled: boolean;
  emitAudio: boolean;
};

const latencyCompensation = (config: AppConfig | null): number =>
  config?.mic_latency_compensation_sec ?? DEFAULT_MIC_LATENCY_COMPENSATION_SEC;

const combineMultiChannel = (config: AppConfig | null): boolean =>
  config?.combine_multi_channel ?? true;

function playerConfigs(
  players: readonly PlaybackPlayer[],
  selectedMicId: string | null,
): MicPlayerConfig[] {
  if (players.length === 0) {
    return [{ present: true, id: 'solo', profile: null, microphoneId: selectedMicId }];
  }
  return players.map((player) => ({
    present: true,
    id: player.id,
    profile: player.profile,
    microphoneId: player.microphoneId,
  }));
}

function playerAt(players: readonly MicPlayerConfig[], index: number): MicPlayerConfig {
  const player = players.at(index);
  if (player !== undefined) {
    return player;
  }
  return {
    present: false,
    id: `inactive-${index + 1}`,
    profile: null,
    microphoneId: null,
  };
}

function captureSettings(
  multiplayer: boolean,
  playbackActive: boolean,
  micUserEnabled: boolean,
  micMonitorUserEnabled: boolean,
): CaptureSettings {
  if (multiplayer) {
    return {
      captureEnabled: playbackActive || micMonitorUserEnabled,
      pitchEnabled: playbackActive,
      emitAudio: micMonitorUserEnabled,
    };
  }
  const pitchEnabled = playbackActive && micUserEnabled;
  return {
    captureEnabled: pitchEnabled || micMonitorUserEnabled,
    pitchEnabled,
    emitAudio: micMonitorUserEnabled,
  };
}

function usePlayerMic({
  player,
  captureEnabled,
  pitchEnabled,
  emitAudio,
  source,
  latencySec,
}: PlayerMicInput): InternalPlayerMicState {
  const shouldCapture = captureEnabled && player.present;
  const shouldTrackPitch = pitchEnabled && player.present;
  const captureOptions = useMemo(() => ({ emit_audio: emitAudio }), [emitAudio]);
  const { active: micCaptureActive, error: micCaptureError } = useMicCapture({
    captureId: player.id,
    deviceId: player.microphoneId,
    enabled: shouldCapture,
    options: captureOptions,
  });
  const {
    latestPitch,
    active: micPitchActive,
    error: micPitchError,
  } = useMicPitch(player.id, shouldTrackPitch);
  const { series, score } = usePitchScoring(
    { ...source, isReady: source.isReady && player.present },
    latestPitch,
    latencySec,
  );
  const micReady = micCaptureActive && micPitchActive;

  return {
    ...player,
    micName: '',
    pitchScore: micReady ? score : null,
    rawScore: score,
    series,
    micCaptureActive,
    micPitchActive,
    micReady,
    error: micCaptureError ?? micPitchError,
  };
}

function namePlayer(player: InternalPlayerMicState, devices: readonly MicDevice[]) {
  const device = devices.find((candidate) => candidate.deviceId === player.microphoneId);
  return {
    id: player.id,
    profile: player.profile,
    microphoneId: player.microphoneId,
    micName: device?.label ?? player.microphoneId ?? 'Default',
    pitchScore: player.pitchScore,
    rawScore: player.rawScore,
    series: player.series,
    micCaptureActive: player.micCaptureActive,
    micPitchActive: player.micPitchActive,
    micReady: player.micReady,
    error: player.error,
  } satisfies PlaybackPlayerMicState;
}

function errorPrefix(multiplayer: boolean, index: number): string {
  return multiplayer ? `Player ${index + 1}` : 'Microphone';
}

type MicStateInput = {
  multiplayer: boolean;
  players: PlaybackPlayerMicState[];
  primary: PlaybackPlayerMicState;
  micUserEnabled: boolean;
  micMonitorUserEnabled: boolean;
};

function micState(input: MicStateInput): PlaybackMicState {
  const { multiplayer, players, primary } = input;
  if (multiplayer) {
    return {
      multiplayer,
      players,
      micUserEnabled: true,
      micMonitorUserEnabled: input.micMonitorUserEnabled,
      selectedMicId: primary.microphoneId,
      micName: primary.micName,
      pitchScore: primary.pitchScore,
      rawScore: primary.rawScore,
      series: primary.series,
      micCaptureActive: primary.micCaptureActive,
      micPitchActive: primary.micPitchActive,
      micReady: primary.micReady,
    };
  }
  return {
    multiplayer,
    players,
    micUserEnabled: input.micUserEnabled,
    micMonitorUserEnabled: input.micMonitorUserEnabled,
    selectedMicId: primary.microphoneId,
    micName: primary.micName,
    pitchScore: primary.pitchScore,
    rawScore: primary.rawScore,
    series: primary.series,
    micCaptureActive: primary.micCaptureActive,
    micPitchActive: primary.micPitchActive,
    micReady: primary.micReady,
  };
}

export function PlaybackMicProvider({ config, players, children }: PlaybackMicProviderProps) {
  const sessionPlayers = players ?? EMPTY_PLAYERS;
  const { isReady, isPlaying, paused, duration } = usePlaybackTransportState();
  const { subscribe, getScoringBuffer } = usePlaybackTransportActions();
  const persistConfig = usePlaybackConfigPersist(config);
  const multiplayer = sessionPlayers.length > 0;
  const [micUserEnabled, setMicUserEnabled] = useState(config?.mic_active ?? true);
  const [micMonitorUserEnabled, setMicMonitorUserEnabled] = useState(
    config?.mic_monitoring ?? false,
  );
  const [selectedMicId, setSelectedMicId] = useState<string | null>(config?.preferred_mic ?? null);
  const micDevices = useMicDevices(undefined, combineMultiChannel(config));
  const settings = captureSettings(
    multiplayer,
    isReady && isPlaying && !paused,
    micUserEnabled,
    micMonitorUserEnabled,
  );
  const source = useMemo<PitchScoringSource>(
    () => ({ isReady, duration, getReferenceBuffer: getScoringBuffer, subscribe }),
    [duration, getScoringBuffer, isReady, subscribe],
  );
  const configs = playerConfigs(sessionPlayers, selectedMicId);
  const latencySec = latencyCompensation(config);
  const playerInput = (index: number): PlayerMicInput => ({
    player: playerAt(configs, index),
    ...settings,
    source,
    latencySec,
  });
  const slotOne = usePlayerMic(playerInput(0));
  const slotTwo = usePlayerMic(playerInput(1));
  const slotThree = usePlayerMic(playerInput(2));
  const slotFour = usePlayerMic(playerInput(3));
  const namedPlayers = [slotOne, slotTwo, slotThree, slotFour]
    .filter((player) => player.present)
    .map((player) => namePlayer(player, micDevices));
  const primary = namedPlayers[0];
  const reactiveRef = useMicReactive(primary.id, primary.micReady);

  const shownErrors = useRef(new Set<string>());
  useEffect(() => {
    for (const [index, player] of namedPlayers.entries()) {
      if (player.error === null) {
        shownErrors.current.delete(player.id);
        continue;
      }
      if (!shownErrors.current.has(player.id)) {
        shownErrors.current.add(player.id);
        toast.error(`${errorPrefix(multiplayer, index)}: ${player.error}`);
      }
    }
  }, [multiplayer, namedPlayers]);

  const handleToggleMic = useCallback(() => {
    if (multiplayer) {
      return;
    }
    setMicUserEnabled((previous) => {
      const next = !previous;
      if (!next && micMonitorUserEnabled) {
        setMicMonitorUserEnabled(false);
        persistConfig({ mic_active: false, mic_monitoring: false });
      } else {
        persistConfig({ mic_active: next });
      }
      return next;
    });
  }, [micMonitorUserEnabled, multiplayer, persistConfig]);

  const handleCycleMic = useCallback(() => {
    if (multiplayer || micDevices.length <= 1) {
      return;
    }
    const currentIndex = micDevices.findIndex((device) => device.deviceId === selectedMicId);
    const next = micDevices[(currentIndex + 1) % micDevices.length];
    setSelectedMicId(next.deviceId);
    persistConfig({ preferred_mic: next.deviceId });
  }, [micDevices, multiplayer, persistConfig, selectedMicId]);

  const handleToggleMicMonitor = useCallback(() => {
    setMicMonitorUserEnabled((previous) => {
      const next = !previous;
      persistConfig({ mic_monitoring: next });
      if (!multiplayer && next && !micUserEnabled) {
        setMicUserEnabled(true);
        persistConfig({ mic_active: true });
      }
      return next;
    });
  }, [micUserEnabled, multiplayer, persistConfig]);

  const stateValue = useMemo(
    () =>
      micState({
        multiplayer,
        players: namedPlayers,
        primary,
        micUserEnabled,
        micMonitorUserEnabled,
      }),
    [micMonitorUserEnabled, micUserEnabled, multiplayer, namedPlayers, primary],
  );
  const actionsValue = useMemo<PlaybackMicActions>(
    () => ({ reactiveRef, handleToggleMic, handleCycleMic, handleToggleMicMonitor }),
    [handleCycleMic, handleToggleMic, handleToggleMicMonitor, reactiveRef],
  );

  return (
    <MicStateContext.Provider value={stateValue}>
      <MicActionsContext.Provider value={actionsValue}>{children}</MicActionsContext.Provider>
    </MicStateContext.Provider>
  );
}

export function usePlaybackMicState(): PlaybackMicState {
  const context = useContext(MicStateContext);
  if (!context) {
    throw new Error('usePlaybackMicState must be used within a PlaybackMicProvider');
  }
  return context;
}

export function usePlaybackMicActions(): PlaybackMicActions {
  const context = useContext(MicActionsContext);
  if (!context) {
    throw new Error('usePlaybackMicActions must be used within a PlaybackMicProvider');
  }
  return context;
}
