import { CheckCircle2Icon } from 'lucide-react';

import { t } from '@/i18n';

import { GENERIC_DESCRIPTION, InfoLine, SoloFooter, type FocusCtx, type ViewParts } from '../parts';

type Args = {
  ctx: FocusCtx;
  version: string;
  onRestart: () => void;
};

export const installedView = ({ ctx, version, onRestart }: Args): ViewParts => ({
  description: GENERIC_DESCRIPTION,
  body: (
    <InfoLine icon={CheckCircle2Icon}>
      {t('updates.installed.updateInstalledRestartNowToDescription', { value1: version })}
    </InfoLine>
  ),
  footer: <SoloFooter ctx={ctx} label="updates.installed.restartNow" onClick={onRestart} />,
});
