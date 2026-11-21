import { t } from '@/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { cn } from '@/shared/utils/cn';
import type { WishPlaylist } from '@/types/WishPlaylist';

type WishPlaylistListProps = {
  playlists: WishPlaylist[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export const WishPlaylistList = ({ playlists, selectedId, onSelect }: WishPlaylistListProps) => (
  <Card>
    <CardHeader>
      <CardTitle>{t('playlists.list.title')}</CardTitle>
    </CardHeader>
    <CardContent>
      {playlists.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('playlists.list.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {playlists.map((playlist) => (
            <li key={playlist.id}>
              <button
                type="button"
                onClick={() => onSelect(playlist.id)}
                className={cn(
                  'flex w-full flex-col items-start rounded-md px-3 py-2 text-left hover:bg-accent',
                  selectedId === playlist.id && 'bg-accent',
                )}
              >
                <span className="truncate text-sm font-medium">{playlist.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t('playlists.list.counts', {
                    ready: playlist.counts.ready,
                    total: playlist.counts.total,
                  })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </CardContent>
  </Card>
);
