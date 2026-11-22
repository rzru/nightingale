import type { AnalysisAutoTune } from '@/types/AnalysisAutoTune';
import type { AppConfig } from '@/types/AppConfig';

import { updateMicMonitorGain } from './microphone';
import { invoke } from './runtime';

export function getPreloadedConfig(): AppConfig | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return window.__NIGHTINGALE_APP_CONFIG__;
}

export const loadConfig = async (): Promise<AppConfig> => {
  return await invoke<AppConfig>('load_config');
};

export const saveConfig = async (config: AppConfig): Promise<AppConfig> => {
  const saved = await invoke<AppConfig>('save_config', { config });

  if (saved.mic_monitor_gain !== null) {
    updateMicMonitorGain(saved.mic_monitor_gain);
  }

  return saved;
};

/** Detect the GPU again and pick fitting analysis settings (model, batch size). */
export const autoTuneAnalysis = async (): Promise<AnalysisAutoTune> => {
  return await invoke<AnalysisAutoTune>('auto_tune_analysis');
};
