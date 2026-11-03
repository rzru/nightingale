import { t } from '@/i18n';
import { Spinner } from '@/shared/components/ui/spinner';

import { GENERIC_DESCRIPTION, SoloFooter, type FocusCtx, type ViewParts } from '../parts';

type Args = {
  ctx: FocusCtx;
  onClose: () => void;
};

export const checkingView = ({ ctx, onClose }: Args): ViewParts => ({
  description: GENERIC_DESCRIPTION,
  body: (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <Spinner className="size-4" />
      <span>{t('updates.checking.checkingForUpdates')}</span>
    </p>
  ),
  footer: <SoloFooter ctx={ctx} label="common.actions.close" onClick={onClose} />,
});
