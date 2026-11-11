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
import { t } from '@/i18n';
import { defaultPlayerColor, type PlayerColor } from '@/shared/player-colors';
import type { AppConfig } from '@/types/AppConfig';

import {
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from './playback-transport-context';
import type { RoomPlaybackView, RoomRemotePlayer } from './room-playback-context';
import { useRoomPlaybackView } from './room-playback-hooks';

export type PlaybackPlayerMicState = {
  id: string;
  /** A singer in a room: no local microphone, pitch arrives over the socket. */
  remote?: boolean;
  /** The room member's display name; `null` for local seats. */
  name: string | null;
  profile: string | null;
  microphoneId: string | null;
  color: PlayerColor;
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
  devices: readonly MicDevice[];
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
  selectMic: (deviceId: string) => void;
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
  /** Remote singers have no microphone; their pitch arrives over the room. */
  remote?: boolean;
  present: boolean;
  id: string;
  /** Room singers carry their member name; local seats do not. */
  name: string | null;
  profile: string | null;
  microphoneId: string | null;
  color: PlayerColor;
};

type InternalPlayerMicState = PlaybackPlayerMicState & { present: boolean };

type PlayerMicInput = {
  player: MicPlayerConfig;
  captureEnabled: boolean;
  pitchEnabled: boolean;
  emitAudio: boolean;
  source: PitchScoringSource;
  latencySec: number;
  /** Present for room singers: their pitch and score arrive over the socket. */
  remote?: RoomRemotePlayer;
};

type CaptureSettings = {
  captureEnabled: boolean;
  pitchEnabled: boolean;
  emitAudio: boolean;
};

const latencyCompensation = (config: AppConfig | null): number =>
  config?.mic_latency_compensation_sec ?? DEFAULT_MIC_LATENCY_COMPENSATION_SEC;

const combineMultiChannel = (config: AppConfig | null, multiplayer: boolean): boolean =>
  multiplayer
    ? (config?.multiplayer_combine_multi_channel ?? true)
    : (config?.combine_multi_channel ?? true);

/** The local singer: from the session in local multiplayer, from the room in a
 * room, or a plain solo seat in both. */
function localConfigs(
  players: readonly PlaybackPlayer[],
  selectedMicId: string | null,
  room: RoomPlaybackView | null,
): MicPlayerConfig[] {
  if (players.length > 0) {
    return players.map((player) => ({
      present: true,
      id: player.id,
      name: null,
      profile: player.profile,
      microphoneId: player.microphoneId,
      color: player.color,
    }));
  }

  const self = room?.self ?? null;

  return [
    {
      present: true,
      id: self?.id ?? 'solo',
      name: null,
      profile: self?.name ?? null,
      microphoneId: selectedMicId,
      color: self?.color ?? defaultPlayerColor(0),
    },
  ];
}

/** Remote singers: no microphone, pitch and score arrive over the room. */
function remoteConfigs(room: RoomPlaybackView | null): MicPlayerConfig[] {
  return [...(room?.remote.entries() ?? [])].map(([id, player]) => ({
    present: true,
    id,
    name: player.name,
    profile: null,
    microphoneId: null,
    color: player.color,
    remote: true,
  }));
}

function playerConfigs(
  players: readonly PlaybackPlayer[],
  selectedMicId: string | null,
  room: RoomPlaybackView | null,
): MicPlayerConfig[] {
  return [...localConfigs(players, selectedMicId, room), ...remoteConfigs(room)];
}

function playerAt(players: readonly MicPlayerConfig[], index: number): MicPlayerConfig {
  const player = players.at(index);
  if (player !== undefined) {
    return player;
  }
  return {
    present: false,
    id: `inactive-${index + 1}`,
    name: null,
    profile: null,
    microphoneId: null,
    color: defaultPlayerColor(index),
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
      emitAudio: playbackActive && micMonitorUserEnabled,
    };
  }
  const pitchEnabled = playbackActive && micUserEnabled;
  return {
    captureEnabled: pitchEnabled || micMonitorUserEnabled,
    pitchEnabled,
    emitAudio: playbackActive && micMonitorUserEnabled,
  };
}

function usePlayerMic({
  player,
  captureEnabled,
  pitchEnabled,
  emitAudio,
  source,
  latencySec,
  remote,
}: PlayerMicInput): InternalPlayerMicState {
  const isRemote = player.remote === true;
  const shouldCapture = captureEnabled && player.present && !isRemote;
  const shouldTrackPitch = pitchEnabled && player.present && !isRemote;
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
    // Remote singers have no local capture; their series arrives over the room.
    { ...source, isReady: source.isReady && player.present && !isRemote },
    latestPitch,
    latencySec,
  );
  return playerMicState(player, remote, {
    micReady: micCaptureActive && micPitchActive,
    score,
    series,
    error: micCaptureError ?? micPitchError,
  });
}

/** Remote singers take their score and series from the room instead of capture. */
const playerMicState = (
  player: MicPlayerConfig,
  remote: RoomRemotePlayer | undefined,
  local: { micReady: boolean; score: number; series: PitchSeries; error: string | null },
): InternalPlayerMicState => {
  if (player.remote === true) {
    return {
      ...player,
      micName: '',
      pitchScore: remote?.score ?? null,
      rawScore: remote?.score ?? 0,
      series: remote?.series ?? local.series,
      micCaptureActive: false,
      micPitchActive: false,
      micReady: remote !== undefined,
      error: local.error,
    };
  }

  return {
    ...player,
    micName: '',
    pitchScore: local.micReady ? local.score : null,
    rawScore: local.score,
    series: local.series,
    micCaptureActive: local.micReady,
    micPitchActive: local.micReady,
    micReady: local.micReady,
    error: local.error,
  };
};

function namePlayer(player: InternalPlayerMicState, devices: readonly MicDevice[]) {
  const device = devices.find((candidate) => candidate.deviceId === player.microphoneId);
  return {
    id: player.id,
    remote: player.remote === true,
    name: player.name,
    profile: player.profile,
    microphoneId: player.microphoneId,
    color: player.color,
    micName: device?.label ?? player.microphoneId ?? t('settings.microphone.default'),
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
  return multiplayer
    ? t('playback.players.playerNumber', { number: index + 1 })
    : t('settings.microphone.label');
}

type MicStateInput = {
  multiplayer: boolean;
  players: PlaybackPlayerMicState[];
  devices: readonly MicDevice[];
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
      devices: input.devices,
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
    devices: input.devices,
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

const reactiveInput = (slot: InternalPlayerMicState) => ({
  captureId: slot.id,
  enabled: slot.micReady && slot.remote !== true,
});

const isMultiplayer = (
  players: readonly PlaybackPlayer[],
  room: RoomPlaybackView | null,
): boolean => players.length > 0 || (room !== null && room.remote.size > 0);

const makePlayerInput =
  (input: {
    configs: MicPlayerConfig[];
    latencySec: number;
    room: RoomPlaybackView | null;
    settings: CaptureSettings;
    source: PitchScoringSource;
  }) =>
  (index: number): PlayerMicInput => {
    const player = playerAt(input.configs, index);
    const remote = player.remote === true ? input.room?.remote.get(player.id) : undefined;

    return {
      player,
      ...input.settings,
      source: input.source,
      latencySec: input.latencySec,
      remote,
    };
  };

export function PlaybackMicProvider({ config, players, children }: PlaybackMicProviderProps) {
  const sessionPlayers = players ?? EMPTY_PLAYERS;
  const { isReady, isPlaying, paused, duration } = usePlaybackTransportState();
  const { subscribe, getScoringBuffer } = usePlaybackTransportActions();
  const persistConfig = usePlaybackConfigPersist(config);
  const room = useRoomPlaybackView();
  const multiplayer = isMultiplayer(sessionPlayers, room);
  const [micUserEnabled, setMicUserEnabled] = useState(config?.mic_active ?? true);
  const [micMonitorUserEnabled, setMicMonitorUserEnabled] = useState(
    config?.mic_monitoring ?? false,
  );
  const [selectedMicId, setSelectedMicId] = useState<string | null>(config?.preferred_mic ?? null);
  const micDevices = useMicDevices(undefined, combineMultiChannel(config, multiplayer));
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
  const configs = playerConfigs(sessionPlayers, selectedMicId, room);
  const latencySec = latencyCompensation(config);
  const playerInput = makePlayerInput({ configs, settings, source, latencySec, room });
  const slotOne = usePlayerMic(playerInput(0));
  const slotTwo = usePlayerMic(playerInput(1));
  const slotThree = usePlayerMic(playerInput(2));
  const slotFour = usePlayerMic(playerInput(3));
  const namedPlayers = [slotOne, slotTwo, slotThree, slotFour]
    .filter((player) => player.present)
    .map((player) => namePlayer(player, micDevices));
  const primary = namedPlayers[0];
  // Remote singers have no local capture to subscribe to.
  const reactiveRef = useMicReactive([
    reactiveInput(slotOne),
    reactiveInput(slotTwo),
    reactiveInput(slotThree),
    reactiveInput(slotFour),
  ]);

  const shownErrors = useRef(new Set<string>());
  useEffect(() => {
    for (const [index, player] of namedPlayers.entries()) {
      if (player.error === null) {
        shownErrors.current.delete(player.id);
        continue;
      }
      if (!shownErrors.current.has(player.id)) {
        shownErrors.current.add(player.id);
        toast.error(
          t('playback.playbackMicContext.message', {
            value1: errorPrefix(multiplayer, index),
            value2: player.error,
          }),
        );
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
  }, [
    micMonitorUserEnabled,
    multiplayer,
    persistConfig,
    setMicMonitorUserEnabled,
    setMicUserEnabled,
  ]);

  const selectMic = useCallback(
    (deviceId: string) => {
      if (multiplayer || !micDevices.some((device) => device.deviceId === deviceId)) {
        return;
      }
      setSelectedMicId(deviceId);
      persistConfig({ preferred_mic: deviceId });
    },
    [micDevices, multiplayer, persistConfig, setSelectedMicId],
  );

  const handleCycleMic = useCallback(() => {
    if (multiplayer || micDevices.length <= 1) {
      return;
    }
    const currentIndex = micDevices.findIndex((device) => device.deviceId === selectedMicId);
    const next = micDevices[(currentIndex + 1) % micDevices.length];
    selectMic(next.deviceId);
  }, [micDevices, multiplayer, selectMic, selectedMicId]);

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
  }, [micUserEnabled, multiplayer, persistConfig, setMicMonitorUserEnabled, setMicUserEnabled]);

  const stateValue = useMemo(
    () =>
      micState({
        multiplayer,
        players: namedPlayers,
        devices: micDevices,
        primary,
        micUserEnabled,
        micMonitorUserEnabled,
      }),
    [micDevices, micMonitorUserEnabled, micUserEnabled, multiplayer, namedPlayers, primary],
  );
  const actionsValue = useMemo<PlaybackMicActions>(
    () => ({ reactiveRef, handleToggleMic, handleCycleMic, handleToggleMicMonitor, selectMic }),
    [handleCycleMic, handleToggleMic, handleToggleMicMonitor, reactiveRef, selectMic],
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
