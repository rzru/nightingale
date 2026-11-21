import { RotateCcwIcon, SparklesIcon } from 'lucide-react';

import { usePrepareWish } from '@/features/playlists/queries/use-playlists-mutations';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { Progress } from '@/shared/components/ui/progress';
import { TableCell, TableRow } from '@/shared/components/ui/table';
import { formatSeconds } from '@/shared/utils/format-duration';
import type { Wish } from '@/types/Wish';

import { WishStatusBadge } from './wish-status-badge';

type WishRowProps = {
  wish: Wish;
  /** Download progress, when this wish is the one yt-dlp is fetching. */
  progress: number | null;
};

const WishAction = ({ wish }: { wish: Wish }) => {
  const prepare = usePrepareWish();

  if (wish.status !== 'missing' && wish.status !== 'available' && wish.status !== 'failed') {
    return null;
  }
  const retry = wish.status === 'failed';

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={prepare.isPending}
      onClick={() => prepare.mutate(wish.id)}
    >
      {retry ? <RotateCcwIcon /> : <SparklesIcon />}
      {t(retry ? 'common.actions.retry' : 'playlists.detail.prepareOne')}
    </Button>
  );
};

export const WishRow = ({ wish, progress }: WishRowProps) => (
  <TableRow>
    <TableCell className="max-w-64">
      <p className="truncate font-medium">{wish.title}</p>
      <p className="truncate text-xs text-muted-foreground">{wish.artist}</p>
      {wish.error !== null && (
        <p className="mt-1 line-clamp-2 text-xs text-destructive" title={wish.error}>
          {wish.error}
        </p>
      )}
    </TableCell>
    <TableCell className="hidden text-muted-foreground sm:table-cell">
      {wish.duration_secs === null ? '' : formatSeconds(wish.duration_secs)}
    </TableCell>
    <TableCell>
      <div className="flex min-w-28 flex-col gap-1">
        <WishStatusBadge status={wish.status} />
        {progress !== null && <Progress value={progress} className="h-1.5" />}
      </div>
    </TableCell>
    <TableCell className="text-right">
      <WishAction wish={wish} />
    </TableCell>
  </TableRow>
);
