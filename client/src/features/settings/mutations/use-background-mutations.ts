import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  addCustomBackgroundUrl,
  importCustomBackgroundFile,
  loadCustomShaderSource,
  removeCustomBackground,
} from '@/bridge/backgrounds';
import { validateCustomShader } from '@/features/playback/lib/custom-shader';
import { t } from '@/i18n';
import { CONFIG } from '@/shared/query-keys';
import type { AppConfig } from '@/types/AppConfig';
import type { CustomBackground } from '@/types/CustomBackground';

import type { BackgroundDraft } from '../lib/background-draft';

async function validateAddedShader(
  before: readonly CustomBackground[],
  saved: AppConfig,
  cacheConfig: (config: AppConfig) => void,
): Promise<AppConfig> {
  const previousIds = new Set(before.map((background) => background.id));
  const added = saved.custom_backgrounds.find((background) => !previousIds.has(background.id));
  if (added === undefined || added.background_type !== 'shader') {
    return saved;
  }

  const source = await loadCustomShaderSource(added);
  const error = validateCustomShader(source);
  if (error === undefined) {
    return saved;
  }

  const reverted = await removeCustomBackground(added.id);
  cacheConfig(reverted);
  const message = error.length > 320 ? `${error.slice(0, 317)}…` : error;
  throw new Error(`Shader did not compile: ${message}`);
}

export function useBackgroundMutations({
  config,
  onAdded,
  onRemoved,
}: {
  config: AppConfig | undefined;
  onAdded: () => void;
  onRemoved: () => void;
}) {
  const queryClient = useQueryClient();
  const cacheConfig = (saved: AppConfig) => {
    queryClient.setQueryData(CONFIG, saved);
    void queryClient.invalidateQueries({ queryKey: CONFIG });
  };
  const addMutation = useMutation({
    mutationFn: async (draft: BackgroundDraft) => {
      if (config === undefined || draft.name.trim() === '') {
        return undefined;
      }
      const saved =
        draft.sourceType === 'url'
          ? await addCustomBackgroundUrl({ name: draft.name, url: draft.url })
          : await importCustomBackgroundFile({
              name: draft.name,
              file: draft.file,
              path: draft.nativePath,
            });
      return validateAddedShader(config.custom_backgrounds, saved, cacheConfig);
    },
    onSuccess: (saved) => {
      if (saved === undefined) {
        return;
      }
      cacheConfig(saved);
      onAdded();
      toast.success(t('settings.mutations.useBackgroundMutations.backgroundAdded'));
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t('settings.backgrounds.addError')),
  });
  const removeMutation = useMutation({
    mutationFn: removeCustomBackground,
    onSuccess: (saved) => {
      cacheConfig(saved);
      onRemoved();
      toast.success(t('settings.mutations.useBackgroundMutations.backgroundRemoved'));
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t('settings.backgrounds.removeError')),
  });

  return { addMutation, removeMutation };
}
