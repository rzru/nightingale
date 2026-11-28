/**
 * Keeps a ref to the latest app config so partial updates can be persisted
 * without listing `config` in callback dependency arrays.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { saveConfig } from '@/bridge/config';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';
import { CONFIG } from '@/shared/query-keys';
import type { AppConfig } from '@/types/AppConfig';

export function usePlaybackConfigPersist(config: AppConfig | null) {
  const queryClient = useQueryClient();
  const configRef = useLatestRef(config);

  const persistConfig = useCallback(
    (patch: Partial<AppConfig>) => {
      const current = configRef.current;
      if (!current) {
        return;
      }

      const next = { ...current, ...patch };
      queryClient.setQueryData(CONFIG, next);
      void saveConfig(next).then((savedConfig) => queryClient.setQueryData(CONFIG, savedConfig));
    },
    [configRef, queryClient],
  );

  return persistConfig;
}
