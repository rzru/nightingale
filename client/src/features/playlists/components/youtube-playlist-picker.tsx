import { DownloadIcon, HeartIcon, ListMusicIcon, RefreshCwIcon } from 'lucide-react';

import { useYoutubePlaylists } from '@/features/playlists/queries/use-playlists-data';
import { useImportPlaylist } from '@/features/playlists/queries/use-playlists-mutations';
import { t, tp } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { Skeleton } from '@/shared/components/ui/skeleton';
import type { YouTubePlaylist } from '@/types/YouTubePlaylist';

type PickerProps = {
  importedIds: ReadonlySet<string>;
  onImported: (id: string) => void;
};

const localId = (playlist: YouTubePlaylist): string => `youtube:${playlist.id}`;

const playlistTitle = (playlist: YouTubePlaylist): string =>
  playlist.kind === 'liked' ? t('playlists.picker.liked') : playlist.title;

const PlaylistRow = ({
  playlist,
  imported,
  busy,
  onImport,
}: {
  playlist: YouTubePlaylist;
  imported: boolean;
  busy: boolean;
  onImport: () => void;
}) => (
  <li className="flex items-center gap-3 py-2">
    {playlist.kind === 'liked' ? (
      <HeartIcon className="size-4 shrink-0 text-pink-500" />
    ) : (
      <ListMusicIcon className="size-4 shrink-0 text-muted-foreground" />
    )}
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium">{playlistTitle(playlist)}</p>
      {playlist.item_count !== null && (
        <p className="text-xs text-muted-foreground">
          {tp('playlists.picker.items', playlist.item_count)}
        </p>
      )}
    </div>
    <Button variant={imported ? 'ghost' : 'outline'} size="sm" disabled={busy} onClick={onImport}>
      {imported ? <RefreshCwIcon /> : <DownloadIcon />}
      {t(imported ? 'playlists.picker.reimport' : 'playlists.picker.import')}
    </Button>
  </li>
);

export const YoutubePlaylistPicker = ({ importedIds, onImported }: PickerProps) => {
  const { data: playlists, isLoading, isError, error } = useYoutubePlaylists(true);
  const importPlaylist = useImportPlaylist(onImported);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('playlists.picker.title')}</CardTitle>
        <CardDescription>{t('playlists.picker.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton className="h-24 w-full" />}
        {isError && (
          <p className="text-sm text-destructive">
            {t('playlists.picker.loadFailed', {
              value1: error instanceof Error ? error.message : String(error),
            })}
          </p>
        )}
        {playlists !== undefined && (
          <ul className="divide-y">
            {playlists.map((playlist) => (
              <PlaylistRow
                key={playlist.id}
                playlist={playlist}
                imported={importedIds.has(localId(playlist))}
                busy={importPlaylist.isPending}
                onImport={() =>
                  importPlaylist.mutate({
                    playlistId: playlist.id,
                    name: playlistTitle(playlist),
                  })
                }
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};
