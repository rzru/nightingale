import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { loadConfig, saveConfig } from '@/bridge/config';
import { t } from '@/i18n';
import { useConfig } from '@/shared/config/use-config';
import { CONFIG } from '@/shared/query-keys';
import type { AppConfig } from '@/types/AppConfig';

export const useConfigMutation = (enabled = true) => {
  const queryClient = useQueryClient();
  const { data: config } = useConfig(enabled);

  return useMutation({
    mutationFn: async (partialConfig: Partial<AppConfig>) => {
      const current = config ?? queryClient.getQueryData<AppConfig>(CONFIG) ?? (await loadConfig());
      return saveConfig({ ...current, ...partialConfig });
    },
    onSuccess: (savedConfig) => {
      queryClient.setQueryData(CONFIG, savedConfig);
      void queryClient.invalidateQueries({ queryKey: CONFIG });
    },
    onError: (error: Error) => {
      toast.error(
        t('shared.config.useConfigMutation.errorUpdatingTheLocalConfig', { value1: error.message }),
      );
    },
  });
};
