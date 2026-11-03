import { t } from '@/i18n';
import { Spinner } from '@/shared/components/ui/spinner';

import { GENERIC_DESCRIPTION, type ViewParts } from '../parts';

export const installingView = (): ViewParts => ({
  description: GENERIC_DESCRIPTION,
  body: (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <Spinner className="size-4" />
      <span>{t('updates.installing.installingUpdateTheAppWillRestartShortly')}</span>
    </p>
  ),
  footer: null,
});
