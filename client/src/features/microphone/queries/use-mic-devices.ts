import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { microphoneAdapter, type MicrophoneAdapter } from '@/bridge/microphone';
import { MIC_DEVICES } from '@/shared/query-keys';
import type { MicrophoneInfo } from '@/types/MicrophoneInfo';

export type MicDevice = {
  deviceId: string;
  label: string;
  name: string;
};

const MIC_DEVICE_CACHE_MS = 60_000;
const EMPTY_MIC_DEVICES: MicDevice[] = [];

const browserMediaDevices = (): MediaDevices | undefined => {
  if (typeof navigator === 'undefined') {
    return undefined;
  }
  return navigator.mediaDevices;
};

async function listMicDevices(
  adapter: MicrophoneAdapter,
  combineChannels: boolean,
): Promise<MicDevice[]> {
  const mics = await adapter.listDevices(combineChannels);
  const seen = new Set<string>();
  return mics
    .filter(({ name, host }) => {
      const key = `${host}\u0000${name}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map(({ id, name, host }: MicrophoneInfo) => ({
      deviceId: id,
      label: host === 'Browser' ? name : `${host}: ${name}`,
      name,
    }));
}

export function useMicDevicesQuery(
  adapter: MicrophoneAdapter = microphoneAdapter,
  enabled = true,
  combineChannels = true,
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const mediaDevices = browserMediaDevices();
    if (!mediaDevices) {
      return undefined;
    }

    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: MIC_DEVICES });
    };
    mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, [enabled, queryClient]);

  const query = useQuery({
    queryKey: [...MIC_DEVICES, combineChannels],
    queryFn: () => listMicDevices(adapter, combineChannels),
    staleTime: MIC_DEVICE_CACHE_MS,
    cacheTime: MIC_DEVICE_CACHE_MS,
    retry: false,
    enabled,
    // Unlike initialData, placeholderData does not mark an empty list as a
    // successful, fresh response and therefore does not suppress enumeration.
    placeholderData: [],
  });
  return { ...query, data: query.data ?? EMPTY_MIC_DEVICES };
}

export function useMicDevices(
  adapter: MicrophoneAdapter = microphoneAdapter,
  combineChannels = true,
) {
  return useMicDevicesQuery(adapter, true, combineChannels).data;
}
