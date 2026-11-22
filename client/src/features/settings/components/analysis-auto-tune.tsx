import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CpuIcon } from 'lucide-react';
import { toast } from 'sonner';

import { autoTuneAnalysis } from '@/bridge/config';
import { Hint } from '@/features/settings/components/settings-controls';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { Field } from '@/shared/components/ui/field';
import { Label } from '@/shared/components/ui/label';
import { CONFIG } from '@/shared/query-keys';
import type { AnalysisAutoTune } from '@/types/AnalysisAutoTune';
import type { AppConfig } from '@/types/AppConfig';

const hardwareLabel = (state: AnalysisAutoTune): string => {
  if (state.device === 'cpu') {
    return t('settings.autoTune.cpu');
  }
  const name = state.gpu_name ?? (state.device === 'mps' ? 'Apple Silicon' : 'GPU');
  if (state.memory_mib === null) {
    return name;
  }
  const gigabytes = Math.round(state.memory_mib / 1024);
  return t('settings.autoTune.gpu', { name, memory: gigabytes });
};

const summary = (state: AnalysisAutoTune | null | undefined): string => {
  if (state === null || state === undefined) {
    return t('settings.autoTune.notYet');
  }
  if (state.model === null || state.batch_size === null) {
    return t('settings.autoTune.manual', { hardware: hardwareLabel(state) });
  }
  const applied = t('settings.autoTune.applied', {
    hardware: hardwareLabel(state),
    model: state.model,
    batch: state.batch_size,
  });
  return state.reduced_after_oom ? `${applied} ${t('settings.autoTune.reduced')}` : applied;
};

/** Hardware-based analysis settings: what was chosen, and a button to redo it. */
export const AnalysisAutoTuneField = ({ config }: { config: AppConfig | undefined }) => {
  const state = config?.analysis_auto_tune;
  const queryClient = useQueryClient();
  const tune = useMutation({
    mutationFn: autoTuneAnalysis,
    onSuccess: async (next) => {
      toast.success(summary(next));
      await queryClient.invalidateQueries({ queryKey: CONFIG });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return (
    <Field>
      <Label>{t('settings.autoTune.label')}</Label>
      <Hint>{summary(state)}</Hint>
      <Button
        variant="outline"
        className="w-fit"
        disabled={tune.isLoading}
        onClick={() => tune.mutate()}
      >
        <CpuIcon />
        {t('settings.autoTune.run')}
      </Button>
    </Field>
  );
};
