import { useState } from 'react';

import { t } from '@/i18n';
import { Field } from '@/shared/components/ui/field';
import { Label } from '@/shared/components/ui/label';
import { useConfig } from '@/shared/config/use-config';
import { useConfigMutation } from '@/shared/config/use-config-mutation';

import { DEFAULTS, MIC_SENSITIVITIES, NAV, SPEAKER_MODES } from './constants';
import { Hint, SettingsButtonGroup } from './settings-controls';

type Props = {
  getFocusClassName: (segment: number, slot?: number) => string;
};

/** Noise gate of the microphone and the "speakers instead of headphones" mode. */
export function MicSensitivityField({ getFocusClassName }: Props) {
  const { data: config } = useConfig();
  const { mutate } = useConfigMutation();
  const [sensitivityInput, setSensitivity] = useState<string | null>(null);
  const [speakerModeInput, setSpeakerMode] = useState<boolean | null>(null);
  const sensitivity = sensitivityInput ?? config?.mic_sensitivity ?? DEFAULTS.mic_sensitivity;
  const speakerMode = speakerModeInput ?? config?.speaker_mode ?? DEFAULTS.speaker_mode;

  return (
    <>
      <Field>
        <Label>{t('settings.microphoneSettings.sensitivity')}</Label>
        <Hint>{t('settings.microphoneSettings.sensitivityDescription')}</Hint>
        <SettingsButtonGroup
          value={sensitivity}
          options={MIC_SENSITIVITIES}
          segment={NAV.general.micSensitivity}
          getFocusClassName={getFocusClassName}
          onChange={(mic_sensitivity) => {
            setSensitivity(mic_sensitivity);
            mutate({ mic_sensitivity });
          }}
        />
      </Field>

      <Field>
        <Label>{t('settings.microphoneSettings.speakerMode')}</Label>
        <Hint>{t('settings.microphoneSettings.speakerModeDescription')}</Hint>
        <SettingsButtonGroup
          value={speakerMode ? 'on' : 'off'}
          options={SPEAKER_MODES}
          segment={NAV.general.speakerMode}
          getFocusClassName={getFocusClassName}
          onChange={(value) => {
            const speaker_mode = value === 'on';
            setSpeakerMode(speaker_mode);
            mutate({ speaker_mode });
          }}
        />
      </Field>
    </>
  );
}
