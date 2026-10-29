import type { ReactNode } from 'react';

import { Stars } from '@/shared/components/shared/stars';
import { formatSeconds } from '@/shared/utils/format-duration';
import type { QueuedStatus } from '@/types/QueuedStatus';
import type { Song } from '@/types/Song';
import type { SongSortColumn } from '@/types/SongSortColumn';

import { AlbumArt } from '../song/album-art';
import { LanguageBadge, NgeBadge } from '../song/language-badge';
import { StatusBadge } from '../song/status-badge';

export type SongColumn = {
  id: string;
  header: ReactNode;
  sortColumn?: SongSortColumn;
  thClassName: string;
  tdClassName: string;
  cell: (song: Song, queueStatus?: QueuedStatus, bestScore?: number) => ReactNode;
};

export const SONG_COLUMNS: SongColumn[] = [
  {
    id: 'thumbnail',
    header: <span className="sr-only">Cover</span>,
    thClassName: 'song-table-thumbnail px-2 py-2 font-medium',
    tdClassName: 'song-table-thumbnail py-1.5 pr-2 pl-2',
    cell: (song) => (
      <AlbumArt
        song={song}
        className="size-10 rounded-md"
        fallbackIconClassName="size-5"
        showVideoBadge
      />
    ),
  },
  {
    id: 'song',
    header: 'Song',
    sortColumn: 'title',
    thClassName: 'song-table-song px-2 py-2 font-medium',
    tdClassName: 'song-table-song px-2 py-2 align-middle font-medium',
    cell: (song, _queueStatus, bestScore) => (
      <div className="min-w-0">
        <div className="flex h-5 min-w-0 items-center gap-2">
          <span className="min-w-0 truncate leading-5">{song.title}</span>
          <LanguageBadge language={song.language} />
          <NgeBadge song={song} />
        </div>
        {bestScore === undefined ? null : <Stars score={bestScore} size="sm" className="mt-0.5" />}
      </div>
    ),
  },
  {
    id: 'band',
    header: 'Artist',
    sortColumn: 'artist',
    thClassName: 'song-table-band px-2 py-2 font-medium',
    tdClassName: 'song-table-band px-2 py-2 text-muted-foreground',
    cell: (song) => <span className="block truncate">{song.artist || '—'}</span>,
  },
  {
    id: 'album',
    header: 'Album',
    sortColumn: 'album',
    thClassName: 'song-table-album px-2 py-2 font-medium',
    tdClassName: 'song-table-album px-2 py-2 text-muted-foreground',
    cell: (song) => <span className="block truncate">{song.album || '—'}</span>,
  },
  {
    id: 'duration',
    header: 'Duration',
    sortColumn: 'duration',
    thClassName: 'song-table-duration px-2 py-2 font-medium',
    tdClassName:
      'song-table-duration px-2 py-2 font-variant-numeric tabular-nums text-muted-foreground',
    cell: (song) => formatSeconds(song.duration_secs),
  },
  {
    id: 'status',
    header: 'Analysis status',
    sortColumn: 'status',
    thClassName: 'song-table-status px-2 py-2 text-right font-medium',
    tdClassName: 'song-table-status px-2 py-2 text-right',
    cell: (song, queueStatus) => <StatusBadge song={song} queueStatus={queueStatus} />,
  },
];
