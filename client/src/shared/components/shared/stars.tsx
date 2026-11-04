import { StarHalfIcon, StarIcon } from 'lucide-react';

import { halfStarUnits } from '@/features/playback/utils/result';
import { t } from '@/i18n';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/components/ui/tooltip';
import { cn } from '@/shared/utils/cn';

type Size = 'sm' | 'lg';

const sizeClass: Record<Size, string> = {
  sm: 'size-2.5',
  lg: 'size-6',
};

type Props = {
  score: number;
  size?: Size;
  className?: string;
};

export const Stars = ({ score, size = 'lg', className }: Props) => {
  const hs = halfStarUnits(score);
  const filled = Math.floor(hs / 2);
  const hasHalf = hs % 2 === 1;
  const empty = 5 - filled - (hasHalf ? 1 : 0);
  const ic = sizeClass[size];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('flex w-fit flex-row items-center gap-1', className)}>
          <meter
            className="sr-only"
            aria-label={t('shared.shared.stars.score')}
            min={0}
            max={1000}
            value={score}
          />
          {Array.from({ length: filled }, (_, i) => (
            <StarIcon key={`f-${i}`} className={cn(ic, 'fill-primary text-primary')} />
          ))}
          {hasHalf ? (
            <span className="relative inline-flex">
              <StarIcon className={cn(ic, 'text-muted-foreground/25')} />
              <StarHalfIcon className={cn(ic, 'absolute inset-0 fill-primary text-primary')} />
            </span>
          ) : null}
          {Array.from({ length: empty }, (_, i) => (
            <StarIcon key={`e-${i}`} className={cn(ic, 'text-muted-foreground/25')} />
          ))}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={4}>
        {t('shared.shared.stars.scoreValue1', { value1: score })}
      </TooltipContent>
    </Tooltip>
  );
};
