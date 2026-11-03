import { LoaderCircleIcon } from 'lucide-react';

import { useSongsMeta } from '@/features/library/queries/use-songs';
import { t } from '@/i18n';
import { Progress as ShadCnProgress } from '@/shared/components/ui/progress';
import { useConfig } from '@/shared/config/use-config';
import type { LibrarySource } from '@/types/LibrarySource';

function sourceLabel(source: LibrarySource | null | undefined): string {
  switch (source?.kind) {
    case 'jellyfin':
      return 'Jellyfin';
    case 'navidrome':
      return 'Navidrome';
    case 'plex':
      return 'Plex Media Server';
    case 'folder':
      return t('library.source.folder');
    case undefined: {
      throw new Error('Not implemented yet: undefined case');
    }
    default:
      return t('library.source.library');
  }
}

export const LibraryProgress = () => {
  const { data: meta } = useSongsMeta();
  const { data: config } = useConfig();

  if (!meta) {
    return null;
  }

  const { count, processed_count, folder } = meta;

  // Pre-first-page window: scan kicked off (folder label set) but the source
  // hasn't told us how big the catalogue is yet, so the determinate bar
  // would be `max=0`. Show an indeterminate "Connecting…" hint so the user
  // knows something is happening during the initial round-trip (Jellyfin
  // `/Items`, Navidrome `getAlbumList2`, Plex section metadata).
  if (folder && count === 0 && processed_count === 0) {
    return (
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <LoaderCircleIcon className="size-3 animate-spin" />
        {t('library.libraryProgress.connectingToSource', {
          source: sourceLabel(config?.library_source),
        })}
      </div>
    );
  }

  if (count === processed_count) {
    return null;
  }

  return <ShadCnProgress max={count} value={processed_count} />;
};
