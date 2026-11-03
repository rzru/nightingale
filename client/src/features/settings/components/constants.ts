import { DEFAULT_PLAYBACK_SCALE } from '@/features/playback/lib/display-scale';
import {
  DEFAULT_MIC_LATENCY_COMPENSATION_SEC,
  MAX_MIC_LATENCY_COMPENSATION_SEC,
} from '@/features/playback/lib/pitch/constants';
import type { AppConfig } from '@/types/AppConfig';

export { PLAYBACK_SCALE_MAX, PLAYBACK_SCALE_MIN } from '@/features/playback/lib/display-scale';

export type SettingsTab = 'general' | 'playback' | 'analysis';
export type SettingsOption = { value: string; label: string; description?: string };

export const SETTINGS_TABS: { value: SettingsTab; label: string }[] = [
  { value: 'general', label: 'settings.constants.general' },
  { value: 'playback', label: 'settings.constants.playback' },
  { value: 'analysis', label: 'settings.constants.analysis' },
];

export const SEPARATORS: SettingsOption[] = [
  {
    value: 'karaoke',
    label: 'settings.constants.uvrKaraoke',
    description: 'settings.constants.usuallySeparatesMoreCleanlyButDescription',
  },
  {
    value: 'demucs',
    label: 'settings.constants.demucs',
    description: 'settings.constants.smootherAndMoreConsistentWithDescription',
  },
];

export const ASR_ENGINES: SettingsOption[] = [
  {
    value: 'whisper',
    label: 'settings.constants.whisper',
    description: 'settings.constants.worksInAnyLanguageAndDescription',
  },
  {
    value: 'parakeet',
    label: 'settings.constants.parakeetV3Experimental',
    description: 'settings.constants.muchFasterAndProducesItsDescription',
  },
];

export const ALIGN_BACKENDS: SettingsOption[] = [
  {
    value: 'whisperx',
    label: 'settings.constants.whisperx',
    description: 'settings.constants.theReliableDefaultTimingWordsDescription',
  },
  {
    value: 'ctc',
    label: 'settings.constants.ctcForcedAlignmentExperimental',
    description: 'settings.constants.calculatesWordStartEndPointsDescription',
  },
  {
    value: 'qwen',
    label: 'settings.constants.qwenForcedAlignmentExperimental',
    description: 'settings.constants.aFastAiModelCoveringDescription',
  },
];

export const MODELS = ['large-v3', 'large-v3-turbo', 'medium', 'small', 'base', 'tiny'];

export const PLAYBACK_MODES: SettingsOption[] = [
  {
    value: 'classic',
    label: 'settings.constants.classicMode',
    description: 'settings.constants.playbackReplacesTheMenuInDescription',
  },
  {
    value: 'session',
    label: 'settings.constants.sessionMode',
    description: 'settings.constants.playbackUsesASeparateWindowDescription',
  },
];

export const LYRICS_VERTICAL_POSITIONS: SettingsOption[] = [
  { value: 'bottom', label: 'settings.constants.bottom' },
  { value: 'center', label: 'settings.constants.center' },
  { value: 'top', label: 'settings.constants.top' },
];

export const LYRICS_HORIZONTAL_POSITIONS: SettingsOption[] = [
  { value: 'left', label: 'settings.constants.left' },
  { value: 'center', label: 'settings.constants.center' },
  { value: 'right', label: 'settings.constants.right' },
];

export const LYRICS_ROMANIZATION_MODES: SettingsOption[] = [
  { value: 'enabled', label: 'settings.constants.enabled' },
  { value: 'disabled', label: 'settings.constants.disabled' },
];

export const DEFAULTS = {
  separator: 'karaoke',
  asr_engine: 'whisper',
  align_backend: 'whisperx',
  vocal_detection_threshold_pct: 0.15,
  whisper_model: 'large-v3',
  beam_size: 8,
  batch_size: 8,
  mic_monitor_gain: 0.65,
  mic_latency_compensation_sec: DEFAULT_MIC_LATENCY_COMPENSATION_SEC,
  combine_multi_channel: true,
  multiplayer_combine_multi_channel: true,
  auto_analyze: false,
  master_volume: 1,
  last_background: { kind: 'built_in_shader', id: 'plasma' },
  playback_mode: 'classic',
  lyrics_vertical_position: 'bottom',
  lyrics_horizontal_position: 'center',
  lyrics_scale: DEFAULT_PLAYBACK_SCALE,
  pitch_graph_scale: DEFAULT_PLAYBACK_SCALE,
  lyrics_romanization_mode: 'enabled',
} satisfies Pick<
  AppConfig,
  | 'separator'
  | 'asr_engine'
  | 'align_backend'
  | 'vocal_detection_threshold_pct'
  | 'whisper_model'
  | 'beam_size'
  | 'batch_size'
  | 'mic_monitor_gain'
  | 'mic_latency_compensation_sec'
  | 'combine_multi_channel'
  | 'multiplayer_combine_multi_channel'
  | 'auto_analyze'
  | 'master_volume'
  | 'last_background'
  | 'playback_mode'
  | 'lyrics_vertical_position'
  | 'lyrics_horizontal_position'
  | 'lyrics_scale'
  | 'pitch_graph_scale'
  | 'lyrics_romanization_mode'
>;

export const MIC_MONITOR_GAIN_STEP = 0.01;
export const MIC_MONITOR_GAIN_MAX = 2;
export const MIC_LATENCY_STEP = 0.005;
export const MIC_LATENCY_MAX = MAX_MIC_LATENCY_COMPENSATION_SEC;
export const PLAYBACK_SCALE_STEP = 0.05;
// Vocal-detection threshold is stored as a fraction of peak RMS (0-1) but shown
// as a percentage. Capped at 60% since anything higher trims almost everything.
export const VOCAL_THRESHOLD_STEP = 0.01;
export const VOCAL_THRESHOLD_MIN = 0;
export const VOCAL_THRESHOLD_MAX = 0.6;
export const NUMBER_PICKER_SIZE = 16;

export const NAV = {
  tabSegment: 0,
  general: {
    window: 1,
    language: 2,
    microphone: 3,
    micMonitorGain: 4,
    micLatency: 5,
    micTest: 6,
  },
  playback: {
    background: 1,
    mode: 2,
    masterVolume: 3,
    lyricsVerticalPosition: 4,
    lyricsHorizontalPosition: 5,
    lyricsScale: 6,
    pitchGraphScale: 7,
    lyricsRomanizationMode: 8,
  },
} as const;

// The Whisper-only "Model size" + "Beam Size" fields sit right after the
// transcription model, so every later field shifts by two segments when
// Parakeet hides them. Fields that aren't rendered map to -1 so focus rings
// never match them.
export function getAnalysisNav(isParakeet: boolean) {
  return isParakeet
    ? {
        separator: 1,
        asrEngine: 2,
        whisperModel: -1,
        beamSize: -1,
        alignBackend: 3,
        autoAnalyze: 4,
        vocalThreshold: 5,
        batchSize: 6,
      }
    : {
        separator: 1,
        asrEngine: 2,
        whisperModel: 3,
        beamSize: 4,
        alignBackend: 5,
        autoAnalyze: 6,
        vocalThreshold: 7,
        batchSize: 8,
      };
}

export function getSettingsStops(
  tab: SettingsTab,
  isParakeet: boolean,
  hasMultiChannelInput: boolean,
) {
  if (tab === 'general') {
    return [3, 2, 2, hasMultiChannelInput ? 2 : 1, 1, 2, 2, 2];
  }
  if (tab === 'playback') {
    return [3, 2, 1, 1, 1, 1, 1, 1, 2, 2];
  }

  return isParakeet
    ? [3, 1, 1, 1, 2, 1, NUMBER_PICKER_SIZE, 2]
    : [3, 1, 1, 1, NUMBER_PICKER_SIZE, 1, 2, 1, NUMBER_PICKER_SIZE, 2];
}
