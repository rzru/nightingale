import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getPreloadedConfig, loadConfig, onMasterVolumeChanged } from '@/bridge/config';
import { CONFIG } from '@/shared/query-keys';
import type { AppConfig } from '@/types/AppConfig';

export const useConfig = () => {
  const queryClient = useQueryClient();
  const preloaded = getPreloadedConfig();

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void onMasterVolumeChanged((masterVolume) => {
      queryClient.setQueryData<AppConfig | undefined>(CONFIG, (config) =>
        config === undefined ? config : { ...config, master_volume: masterVolume },
      );
    }).then((stop) => {
      if (cancelled) {
        stop();
        return undefined;
      }
      unlisten = stop;
      return undefined;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [queryClient]);

  return useQuery({
    queryKey: CONFIG,
    queryFn: loadConfig,
    ...(preloaded !== undefined ? { initialData: preloaded } : {}),
  });
};
