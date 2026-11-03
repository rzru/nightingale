import { Disc3Icon, FolderIcon, MusicIcon } from 'lucide-react';

import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useLibrarySourceActions } from '@/features/sources/hooks/use-library-source-actions';
import { t } from '@/i18n';
import { JellyfinIcon } from '@/shared/components/icons/jellyfin';
import { PlexIcon } from '@/shared/components/icons/plex';
import { Button } from '@/shared/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/shared/components/ui/empty';

export const EmptyLibrary = () => {
  const { selectFolder, isPending, libraryPinned } = useLibrarySourceActions();
  const { setMode } = useDialog();

  // Pinned library: nothing to pick in-app. An empty list here means the
  // configured folder is still scanning or has no supported files.
  if (libraryPinned) {
    return (
      <Empty className="px-4 pt-16 md:pt-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MusicIcon />
          </EmptyMedia>
          <EmptyTitle>{t('library.emptyLibrary.noSongsFound')}</EmptyTitle>
          <EmptyDescription>
            {t('library.emptyLibrary.theConfiguredMusicFolderIsDescription')}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Empty className="px-4 pt-16 md:pt-6">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MusicIcon />
        </EmptyMedia>
        <EmptyTitle>{t('library.emptyLibrary.noLibraryYet')}</EmptyTitle>
        <EmptyDescription>
          {t('library.emptyLibrary.pickAFolderOnThisDescription')}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="max-w-lg flex-col justify-center gap-2 sm:flex-row sm:flex-wrap">
        <Button variant="outline" onClick={() => setMode('plex-connect')} disabled={isPending}>
          <PlexIcon />
          {t('library.emptyLibrary.connectPlex')}
        </Button>
        <Button variant="outline" onClick={() => setMode('navidrome-connect')} disabled={isPending}>
          <Disc3Icon />
          {t('library.emptyLibrary.connectNavidrome')}
        </Button>
        <Button variant="outline" onClick={() => setMode('jellyfin-connect')} disabled={isPending}>
          <JellyfinIcon />
          {t('library.emptyLibrary.connectJellyfin')}
        </Button>
        <Button variant="outline" onClick={() => selectFolder()} disabled={isPending}>
          <FolderIcon />
          {t('library.emptyLibrary.selectFolder')}
        </Button>
      </EmptyContent>
    </Empty>
  );
};
