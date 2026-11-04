import { StarHalfIcon, StarIcon } from 'lucide-react';
import { useState } from 'react';

import { halfStarUnits } from '@/features/playback/utils/result';
import { cn } from '@/shared/utils/cn';

type Size = 'sm' | 'lg';

const sizeClass: Record<Size, string> = {
  sm: 'size-3',
  lg: 'size-5 md:size-6',
};

type Props = {
  score: number | null;
  size?: Size;
  className?: string;
};

export const LiveStars = ({ score, size = 'lg', className }: Props) => {
  const liveUnits = score === null ? null : halfStarUnits(score);
  const [units, setUnits] = useState(liveUnits ?? 0);

  // Pausing stops pitch scoring, so hold the last reading instead of emptying the
  // stars until the score comes back.
  if (liveUnits !== null && liveUnits !== units) {
    setUnits(liveUnits);
  }

  const ic = sizeClass[size];

  return (
    <div className={cn('flex w-fit flex-row items-center gap-0.5', className)} aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => {
        if (units === i * 2 + 1) {
          return (
            <span key={i} className="relative inline-flex">
              <StarIcon className={cn(ic, 'fill-transparent text-white/30')} />
              <StarHalfIcon className={cn(ic, 'absolute inset-0 fill-primary text-primary')} />
            </span>
          );
        }

        if (units >= (i + 1) * 2) {
          return <StarIcon key={i} className={cn(ic, 'fill-primary text-primary')} />;
        }

        return <StarIcon key={i} className={cn(ic, 'fill-transparent text-white/30')} />;
      })}
    </div>
  );
};
