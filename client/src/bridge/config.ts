import type { AppConfig } from '@/types/AppConfig';

import { updateMicMonitorGain } from './microphone';
import { invoke, listen, type UnlistenFn } from './runtime';

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

export const onMasterVolumeChanged = async (
  callback: (volume: number) => void,
): Promise<UnlistenFn> =>
  await listen<unknown>('master-volume-changed', ({ payload }) => {
    if (typeof payload !== 'number' || !Number.isFinite(payload)) {
      return;
    }

    callback(Math.max(0, Math.min(1, payload)));
  });
