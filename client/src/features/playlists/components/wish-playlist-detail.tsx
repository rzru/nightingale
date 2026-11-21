import { SparklesIcon, Trash2Icon } from 'lucide-react';

import {
  useDownloaderStatus,
  useWishPlaylist,
} from '@/features/playlists/queries/use-playlists-data';
import {
  useDeleteWishPlaylist,
  usePreparePlaylist,
} from '@/features/playlists/queries/use-playlists-mutations';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table';
import type { WishCounts } from '@/types/WishCounts';

import { WishRow } from './wish-row';

type WishPlaylistDetailProps = {
  id: string;
  onDeleted: () => void;
};

const countsSummary = (counts: WishCounts): string =>
  t('playlists.detail.summary', {
    ready: counts.ready,
    available: counts.available,
    missing: counts.missing,
    inProgress: counts.in_progress,
    failed: counts.failed,
  });

const useCurrentDownload = () => {
  const { data: status } = useDownloaderStatus();
  return {
    wishId: status?.current_wish_id ?? null,
    progress: status?.current_progress ?? 0,
  };
};

export const WishPlaylistDetail = ({ id, onDeleted }: WishPlaylistDetailProps) => {
  const { data: detail, isLoading } = useWishPlaylist(id);
  const prepare = usePreparePlaylist();
  const remove = useDeleteWishPlaylist(onDeleted);
  const current = useCurrentDownload();

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (detail === null || detail === undefined) {
    return null;
  }
  const { playlist, wishes } = detail;
  const pending = playlist.counts.total - playlist.counts.ready - playlist.counts.in_progress;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{playlist.name}</CardTitle>
        <CardDescription>{countsSummary(playlist.counts)}</CardDescription>
        <CardAction className="flex gap-2">
          <Button
            disabled={prepare.isPending || pending === 0}
            onClick={() => prepare.mutate(playlist.id)}
          >
            <SparklesIcon />
            {t('playlists.detail.prepareAll')}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('playlists.detail.delete')}
            title={t('playlists.detail.delete')}
            disabled={remove.isPending}
            onClick={() => remove.mutate(playlist.id)}
          >
            <Trash2Icon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('library.columns.song')}</TableHead>
              <TableHead className="hidden sm:table-cell">
                {t('library.columns.duration')}
              </TableHead>
              <TableHead>{t('playlists.detail.status')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {wishes.map((wish) => (
              <WishRow
                key={wish.id}
                wish={wish}
                progress={current.wishId === wish.id ? current.progress : null}
              />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};
