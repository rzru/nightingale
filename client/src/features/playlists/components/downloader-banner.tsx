import { CircleStopIcon } from 'lucide-react';

import { useDownloaderStatus } from '@/features/playlists/queries/use-playlists-data';
import { useCancelDownloads } from '@/features/playlists/queries/use-playlists-mutations';
import { t, tp } from '@/i18n';
import { Alert, AlertDescription, AlertTitle } from '@/shared/components/ui/alert';
import { Button } from '@/shared/components/ui/button';
import { Spinner } from '@/shared/components/ui/spinner';
import type { DownloaderStatus } from '@/types/DownloaderStatus';

const bannerText = (status: DownloaderStatus): string =>
  status.installing_tools
    ? t('playlists.downloader.installing')
    : tp('playlists.downloader.running', status.queued + 1);

/** Shown while yt-dlp works: tool install, then the download queue. */
export const DownloaderBanner = () => {
  const { data: status } = useDownloaderStatus();
  const cancel = useCancelDownloads();

  if (status === undefined) {
    return null;
  }
  if (!status.running) {
    return status.last_error === null ? null : (
      <Alert variant="destructive">
        <AlertTitle>{t('playlists.downloader.stopped')}</AlertTitle>
        <AlertDescription>{status.last_error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert>
      <Spinner />
      <AlertTitle>{bannerText(status)}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>{t('playlists.downloader.destination')}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          <CircleStopIcon />
          {t('playlists.downloader.cancel')}
        </Button>
      </AlertDescription>
    </Alert>
  );
};
