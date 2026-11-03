import type { LucideIcon } from 'lucide-react';

import { t, type TranslationKey } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/utils/cn';

export type ActionItemProps = {
  icon: LucideIcon;
  title: TranslationKey;
  description: TranslationKey;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  destructive?: boolean;
};

export const ActionItem = ({
  icon: Icon,
  title,
  description,
  onClick,
  disabled,
  destructive,
}: ActionItemProps) => (
  <Button
    type="button"
    variant={destructive === true ? 'destructive' : 'ghost'}
    size="lg"
    className={cn(
      'h-auto min-h-10 w-full items-start justify-start gap-2 px-2 py-1.5 text-left whitespace-normal',
      // Match the keyboard-focus treatment (ring-2 ring-primary + z-10) on
      // hover so pointer and gamepad/keyboard highlighting look identical.
      'hover:z-10 hover:ring-2 hover:ring-primary',
      destructive === true
        ? 'hover:bg-destructive/10 dark:hover:bg-destructive/20'
        : 'hover:bg-transparent dark:hover:bg-transparent',
    )}
    disabled={disabled}
    onClick={() => void onClick()}
  >
    <Icon className="mt-0.5 size-4" />
    <span className="min-w-0">
      <span className="block text-xs font-medium leading-tight">{t(title)}</span>
      <span
        className={
          destructive === true
            ? 'mt-0.5 block text-[0.625rem] leading-tight text-destructive/70'
            : 'mt-0.5 block text-[0.625rem] leading-tight text-muted-foreground'
        }
      >
        {t(description)}
      </span>
    </span>
  </Button>
);
