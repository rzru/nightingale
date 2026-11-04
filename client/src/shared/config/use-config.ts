import { useQuery } from '@tanstack/react-query';

import { getPreloadedConfig, loadConfig } from '@/bridge/config';
import { CONFIG } from '@/shared/query-keys';

export const useConfig = (enabled = true) => {
  const preloaded = getPreloadedConfig();

  return useQuery({
    queryKey: CONFIG,
    queryFn: loadConfig,
    enabled,
    ...(preloaded !== undefined ? { initialData: preloaded } : {}),
  });
};
