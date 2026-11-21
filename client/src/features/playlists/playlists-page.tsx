import { ArrowLeftIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { DownloaderBanner } from '@/features/playlists/components/downloader-banner';
import { WishPlaylistDetail } from '@/features/playlists/components/wish-playlist-detail';
import { WishPlaylistList } from '@/features/playlists/components/wish-playlist-list';
import { YoutubeAccountCard } from '@/features/playlists/components/youtube-account-card';
import { YoutubePlaylistPicker } from '@/features/playlists/components/youtube-playlist-picker';
import {
  useAccounts,
  usePlaylistEvents,
  useWishPlaylists,
} from '@/features/playlists/queries/use-playlists-data';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';

const PageHeader = () => {
  const navigate = useNavigate();

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {t('playlists.page.title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('playlists.page.description')}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={() => void navigate('/')}>
        <ArrowLeftIcon />
        {t('common.actions.back')}
      </Button>
    </div>
  );
};

const usePlaylistsPage = () => {
  const { data: overview } = useAccounts();
  const { data: playlists = [] } = useWishPlaylists();
  const [chosenId, setChosenId] = useState<string | null>(null);

  // YouTube is the only provider for now.
  const youtube = overview?.accounts.at(0) ?? null;
  const importedIds = useMemo(() => new Set(playlists.map((playlist) => playlist.id)), [playlists]);
  // Fall back to the most recent import so the detail pane is never empty.
  const fallbackId = playlists.at(0)?.id ?? null;
  const selectedId = chosenId !== null && importedIds.has(chosenId) ? chosenId : fallbackId;

  return {
    youtube,
    playlists,
    importedIds,
    selectedId,
    setChosenId,
  };
};

/** « Mes playlists » : link YouTube, import playlists, get them ready to sing. */
export const PlaylistsPage = () => {
  usePlaylistEvents();
  const page = usePlaylistsPage();

  return (
    <div className="h-full overflow-y-auto px-4 pb-5 pt-14 sm:px-6 md:pt-5 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <PageHeader />
        <DownloaderBanner />
        <YoutubeAccountCard account={page.youtube} />

        <div className="grid gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-5">
            <WishPlaylistList
              playlists={page.playlists}
              selectedId={page.selectedId}
              onSelect={page.setChosenId}
            />
            {page.youtube !== null && (
              <YoutubePlaylistPicker importedIds={page.importedIds} onImported={page.setChosenId} />
            )}
          </div>
          {page.selectedId !== null && (
            <WishPlaylistDetail id={page.selectedId} onDeleted={() => page.setChosenId(null)} />
          )}
        </div>
      </div>
    </div>
  );
};
