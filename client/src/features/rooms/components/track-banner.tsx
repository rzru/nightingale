import { MusicIcon } from 'lucide-react';

import { AlbumArt } from '@/features/library/components/song/album-art';
import { t } from '@/i18n';
import { formatSeconds } from '@/shared/utils/format-duration';
import type { Song } from '@/types/Song';

import { useRoomSongs } from '../hooks/use-room-song';

type TrackBannerProps = {
  hash: string | null;
  title: string | null;
};

type BannerContent = {
  heading: string;
  subtitle: string;
  meta: string;
};

function bannerContent(song: Song | undefined, hash: string, title: string | null): BannerContent {
  const tag = `#${hash.slice(0, 8)}`;

  if (song === undefined) {
    return {
      heading: title ?? t('rooms.room.noTrackYet'),
      subtitle: '',
      meta: tag,
    };
  }

  return {
    heading: song.title,
    subtitle: [song.artist, song.album].filter(Boolean).join(' · '),
    meta: `${formatSeconds(song.duration_secs)} · ${tag}`,
  };
}

/**
 * Full-width strip above the room: cover, track, artist, album, and duration.
 * The node only knows a hash and a title; the local library fills the rest.
 */
export function TrackBanner({ hash, title }: TrackBannerProps) {
  const { data: songs } = useRoomSongs(hash === null ? [] : [hash]);
  const song = songs?.at(0);

  if (hash === null) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <MusicIcon className="size-5" aria-hidden="true" />
        {t('rooms.room.noTrackYet')}
      </div>
    );
  }

  const content = bannerContent(song, hash, title);

  return (
    <div className="flex items-center gap-4">
      {song === undefined ? (
        <div className="flex size-20 shrink-0 items-center justify-center bg-muted text-muted-foreground sm:size-24">
          <MusicIcon className="size-8" aria-hidden="true" />
        </div>
      ) : (
        <AlbumArt
          song={song}
          className="size-20 shrink-0 rounded-md shadow-lg sm:size-24"
          fallbackIconClassName="size-8"
          lazy={false}
        />
      )}

      <div className="min-w-0">
        <p className="truncate text-lg font-semibold sm:text-xl">{content.heading}</p>
        {content.subtitle !== '' ? (
          <p className="truncate text-sm text-muted-foreground">{content.subtitle}</p>
        ) : null}
        <p className="text-xs tabular-nums text-muted-foreground">{content.meta}</p>
      </div>
    </div>
  );
}
