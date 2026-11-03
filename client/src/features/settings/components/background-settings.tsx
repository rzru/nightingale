import { useMemo, useState } from 'react';

import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { Field, FieldDescription } from '@/shared/components/ui/field';
import { Label } from '@/shared/components/ui/label';
import { useConfig } from '@/shared/config/use-config';
import { useConfigMutation } from '@/shared/config/use-config-mutation';

import { backgroundOptions, initialBackgroundSelection } from '../lib/background-options';
import { BackgroundManagerDialog } from './background-manager-dialog';
import { SettingsSelect } from './settings-controls';

export function BackgroundSettings({
  selectClassName,
  manageClassName,
  onDialogOpenChange,
}: {
  selectClassName?: string;
  manageClassName?: string;
  onDialogOpenChange?: (open: boolean) => void;
}) {
  const { data: config } = useConfig();
  const { mutate } = useConfigMutation();
  const [open, setOpen] = useState(false);
  const options = useMemo(
    () => backgroundOptions(config?.custom_backgrounds ?? []),
    [config?.custom_backgrounds],
  );
  const selected =
    config === undefined ? options[0].value : initialBackgroundSelection(config, options);
  const updateOpen = (next: boolean) => {
    setOpen(next);
    onDialogOpenChange?.(next);
  };

  return (
    <>
      <Field>
        <Label htmlFor="default-background">
          {t('settings.backgroundSettings.defaultBackground')}
        </Label>
        <FieldDescription>
          {t('settings.backgroundSettings.usedWhenPlaybackStartsPressDescription')}
        </FieldDescription>
        <div className="flex flex-col gap-2 sm:flex-row">
          <SettingsSelect
            id="settings.backgroundSettings.defaultBackground2"
            label={t('settings.backgroundSettings.defaultBackground')}
            placeholder={t('settings.backgroundSettings.selectBackground')}
            value={selected}
            options={options}
            triggerClassName={selectClassName}
            onValueChange={(value) => {
              const option = options.find((candidate) => candidate.value === value);
              if (option !== undefined) {
                mutate({ last_background: option.selection });
              }
            }}
          />
          <Button variant="outline" className={manageClassName} onClick={() => updateOpen(true)}>
            {t('settings.backgroundSettings.manage')}
          </Button>
        </div>
      </Field>

      <BackgroundManagerDialog open={open} config={config} onOpenChange={updateOpen} />
    </>
  );
}
