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
import { usePerformanceRecording } from '@/features/playback/hooks/use-performance-recording';
import {
  usePitchScoring,
  type LiveScoreStats,
  type PitchScoringSource,
} from '@/features/playback/hooks/use-pitch-scoring';
import { usePlaybackConfigPersist } from '@/features/playback/hooks/use-playback-config-persist';
import { useScoreNotes } from '@/features/playback/hooks/use-score-notes';
import { DEFAULT_MIC_LATENCY_COMPENSATION_SEC } from '@/features/playback/lib/pitch/constants';
import { micRmsGate } from '@/features/playback/lib/pitch/mic-gate';
import type { PitchSeries } from '@/features/playback/lib/pitch/state';
import {
  DEFAULT_DIFFICULTY,
  type Difficulty,
  type ScoreNote,
} from '@/features/playback/lib/scoring/note-scoring';
import { LEGACY_SCORING_VERSION, NOTE_SCORING_VERSION } from '@/features/playback/utils/result';
import { t } from '@/i18n';
import { defaultPlayerColor, type PlayerColor } from '@/shared/player-colors';
import type { AppConfig } from '@/types/AppConfig';

import {
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from './playback-transport-context';

export type PlaybackPlayerMicState = {
  id: string;
  profile: string | null;
  microphoneId: string | null;
  color: PlayerColor;
  micName: string;
  pitchScore: number | null;
  rawScore: number;
  /** Combo, accuracy and per-line results; `null` without note scoring. */
  scoreStats: LiveScoreStats | null;
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
  scoreStats: LiveScoreStats | null;
  /** 2 when the song is scored by notes (0..10000), 1 otherwise (0..1000). */
  scoringVersion: number;
  difficulty: Difficulty;
  /** The singer's voice is being recorded right now. */
  recording: boolean;
  series: PitchSeries;
  micCaptureActive: boolean;
  micPitchActive: boolean;
  micReady: boolean;
};

export type PlaybackMicActions = {
  reactiveRef: MicReactiveRef;
  /** End the performance recording; its take folder, or `null` without one. */
  finishRecording: () => Promise<string | null>;
  handleToggleMic: () => void;
  handleCycleMic: () => void;
  handleToggleMicMonitor: () => void;
  selectMic: (deviceId: string) => void;
};

const EMPTY_PLAYERS: readonly PlaybackPlayer[] = [];
const MicStateContext = createContext<PlaybackMicState | null>(null);
const MicActionsContext = createContext<PlaybackMicActions | null>(null);

type PlaybackMicProviderProps = {
  fileHash: string;
  config: AppConfig | null;
  players?: readonly PlaybackPlayer[];
  children: ReactNode;
};

type MicPlayerConfig = {
  present: boolean;
  id: string;
  profile: string | null;
  microphoneId: string | null;
  color: PlayerColor;
};

type InternalPlayerMicState = PlaybackPlayerMicState & { present: boolean; micStalled: boolean };

/** Pause the song and tell the singer when a microphone stops delivering audio. */
function useMicLossPause(micLost: boolean, handlePause: () => void): void {
  useEffect(() => {
    if (micLost) {
      handlePause();
      toast.error(t('playback.playbackMicContext.microphoneLost'), { duration: 10_000 });
    }
  }, [handlePause, micLost]);
}

type PlayerMicInput = {
  player: MicPlayerConfig;
  captureEnabled: boolean;
  pitchEnabled: boolean;
  emitAudio: boolean;
  source: PitchScoringSource;
  latencySec: number;
  notes: readonly ScoreNote[] | null;
  difficulty: Difficulty;
  rmsGate: number;
};

type CaptureSettings = {
  captureEnabled: boolean;
  pitchEnabled: boolean;
  emitAudio: boolean;
};

const scoringDifficulty = (config: AppConfig | null): Difficulty => {
  const value = config?.scoring_difficulty;
  return value === 'easy' || value === 'medium' || value === 'hard' ? value : DEFAULT_DIFFICULTY;
};

/** Recording is for one singer: multiplayer songs are never recorded. */
const recordingEnabled = (config: AppConfig | null, multiplayer: boolean): boolean =>
  !multiplayer && config?.record_performance === true;

const configRmsGate = (config: AppConfig | null): number =>
  micRmsGate(config?.mic_sensitivity, config?.speaker_mode);

const scoringVersionFor = (notes: readonly ScoreNote[] | null): number =>
  notes === null ? LEGACY_SCORING_VERSION : NOTE_SCORING_VERSION;

const latencyCompensation = (config: AppConfig | null): number =>
  config?.mic_latency_compensation_sec ?? DEFAULT_MIC_LATENCY_COMPENSATION_SEC;

const combineMultiChannel = (config: AppConfig | null, multiplayer: boolean): boolean =>
  multiplayer
    ? (config?.multiplayer_combine_multi_channel ?? true)
    : (config?.combine_multi_channel ?? true);

function playerConfigs(
  players: readonly PlaybackPlayer[],
  selectedMicId: string | null,
): MicPlayerConfig[] {
  if (players.length === 0) {
    return [
      {
        present: true,
        id: 'solo',
        profile: null,
        microphoneId: selectedMicId,
        color: defaultPlayerColor(0),
      },
    ];
  }
  return players.map((player) => ({
    present: true,
    id: player.id,
    profile: player.profile,
    microphoneId: player.microphoneId,
    color: player.color,
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
  notes,
  difficulty,
  rmsGate,
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
    stalled: micStalled,
    error: micPitchError,
  } = useMicPitch(player.id, shouldTrackPitch, rmsGate);
  const { series, score, stats } = usePitchScoring(
    { ...source, isReady: source.isReady && player.present },
    latestPitch,
    { latencyCompensationSec: latencySec, notes, difficulty },
  );
  const micReady = micCaptureActive && micPitchActive;

  return {
    ...player,
    micName: '',
    pitchScore: micReady ? score : null,
    rawScore: score,
    scoreStats: stats,
    series,
    micCaptureActive,
    micPitchActive,
    micReady,
    micStalled,
    error: micCaptureError ?? micPitchError,
  };
}

function namePlayer(player: InternalPlayerMicState, devices: readonly MicDevice[]) {
  const device = devices.find((candidate) => candidate.deviceId === player.microphoneId);
  return {
    id: player.id,
    profile: player.profile,
    microphoneId: player.microphoneId,
    color: player.color,
    micName: device?.label ?? player.microphoneId ?? t('settings.microphone.default'),
    pitchScore: player.pitchScore,
    rawScore: player.rawScore,
    scoreStats: player.scoreStats,
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
  scoringVersion: number;
  difficulty: Difficulty;
  recording: boolean;
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
      scoreStats: primary.scoreStats,
      scoringVersion: input.scoringVersion,
      difficulty: input.difficulty,
      recording: false,
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
    scoreStats: primary.scoreStats,
    scoringVersion: input.scoringVersion,
    difficulty: input.difficulty,
    recording: input.recording,
    series: primary.series,
    micCaptureActive: primary.micCaptureActive,
    micPitchActive: primary.micPitchActive,
    micReady: primary.micReady,
  };
}

export function PlaybackMicProvider({
  fileHash,
  config,
  players,
  children,
}: PlaybackMicProviderProps) {
  const sessionPlayers = players ?? EMPTY_PLAYERS;
  const { isReady, isPlaying, paused, duration } = usePlaybackTransportState();
  const { subscribe, getScoringBuffer, getCurrentTime, handlePause } =
    usePlaybackTransportActions();
  const persistConfig = usePlaybackConfigPersist(config);
  const multiplayer = sessionPlayers.length > 0;
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
  const configs = playerConfigs(sessionPlayers, selectedMicId);
  const latencySec = latencyCompensation(config);
  const notes = useScoreNotes(fileHash);
  const difficulty = scoringDifficulty(config);
  const rmsGate = configRmsGate(config);
  const scoringVersion = scoringVersionFor(notes);
  const playerInput = (index: number): PlayerMicInput => ({
    player: playerAt(configs, index),
    ...settings,
    source,
    latencySec,
    notes,
    difficulty,
    rmsGate,
  });
  const slotOne = usePlayerMic(playerInput(0));
  const slotTwo = usePlayerMic(playerInput(1));
  const slotThree = usePlayerMic(playerInput(2));
  const slotFour = usePlayerMic(playerInput(3));
  const namedPlayers = [slotOne, slotTwo, slotThree, slotFour]
    .filter((player) => player.present)
    .map((player) => namePlayer(player, micDevices));
  const primary = namedPlayers[0];
  const recorder = usePerformanceRecording({
    enabled: recordingEnabled(config, multiplayer),
    captureId: slotOne.id,
    playing: settings.pitchEnabled,
    micReady: slotOne.micReady,
    subscribe,
    getCurrentTime,
  });
  const finishRecording = recorder.finish;
  useMicLossPause(
    [slotOne, slotTwo, slotThree, slotFour].some((player) => player.present && player.micStalled),
    handlePause,
  );
  const reactiveRef = useMicReactive([
    { captureId: slotOne.id, enabled: slotOne.micReady },
    { captureId: slotTwo.id, enabled: slotTwo.micReady },
    { captureId: slotThree.id, enabled: slotThree.micReady },
    { captureId: slotFour.id, enabled: slotFour.micReady },
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
  }, [micMonitorUserEnabled, multiplayer, persistConfig]);

  const selectMic = useCallback(
    (deviceId: string) => {
      if (multiplayer || !micDevices.some((device) => device.deviceId === deviceId)) {
        return;
      }
      setSelectedMicId(deviceId);
      persistConfig({ preferred_mic: deviceId });
    },
    [micDevices, multiplayer, persistConfig],
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
  }, [micUserEnabled, multiplayer, persistConfig]);

  const stateValue = useMemo(
    () =>
      micState({
        multiplayer,
        players: namedPlayers,
        devices: micDevices,
        primary,
        micUserEnabled,
        micMonitorUserEnabled,
        scoringVersion,
        difficulty,
        recording: recorder.recording,
      }),
    [
      difficulty,
      recorder.recording,
      micDevices,
      micMonitorUserEnabled,
      micUserEnabled,
      multiplayer,
      namedPlayers,
      primary,
      scoringVersion,
    ],
  );
  const actionsValue = useMemo<PlaybackMicActions>(
    () => ({
      reactiveRef,
      finishRecording,
      handleToggleMic,
      handleCycleMic,
      handleToggleMicMonitor,
      selectMic,
    }),
    [
      finishRecording,
      handleCycleMic,
      handleToggleMic,
      handleToggleMicMonitor,
      reactiveRef,
      selectMic,
    ],
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
