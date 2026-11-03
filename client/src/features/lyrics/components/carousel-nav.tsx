import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/utils/cn';

import { ARIA_DISABLED_CLASS, ringFor } from './parts';

type CarouselNavProps = {
  index: number;
  total: number;
  onChange: (next: number) => void;
  isFocused: (slot: number) => boolean;
};

export const CarouselNav = ({ index, total, onChange, isFocused }: CarouselNavProps) => {
  if (total === 0) {
    return null;
  }

  const safeIndex = Math.min(index, total - 1);
  const prevFocused = isFocused(0);
  const nextFocused = isFocused(1);
  const atStart = safeIndex === 0;
  const atEnd = safeIndex === total - 1;

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground">
        {safeIndex + 1} / {total}
      </span>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => {
          if (atStart) {
            return;
          }
          onChange(safeIndex - 1);
        }}
        aria-disabled={atStart}
        aria-label={t('lyrics.carouselNav.previousMatch')}
        className={cn(ARIA_DISABLED_CLASS, ringFor(prevFocused))}
      >
        <ChevronLeftIcon />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => {
          if (atEnd) {
            return;
          }
          onChange(safeIndex + 1);
        }}
        aria-disabled={atEnd}
        aria-label={t('lyrics.carouselNav.nextMatch')}
        className={cn(ARIA_DISABLED_CLASS, ringFor(nextFocused))}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  );
};
