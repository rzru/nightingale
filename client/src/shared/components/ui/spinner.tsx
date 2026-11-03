import { Loader2Icon } from 'lucide-react';

import { t } from '@/i18n';
import { cn } from '@/shared/utils/cn';

function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <output aria-label={t('common.loading')}>
      <Loader2Icon
        aria-hidden="true"
        className={cn('size-4 animate-spin will-change-transform', className)}
        {...props}
      />
    </output>
  );
}

export { Spinner };
