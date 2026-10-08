import { memo } from 'react';

import { Stars } from '@/shared/components/shared/stars';
import { cn } from '@/shared/utils/cn';
import { formatSeconds } from '@/shared/utils/format-duration';

import { AlbumArt } from '../../song/album-art';
import { LanguageBadge, NgeBadge } from '../../song/language-badge';
import { StatusBadge } from '../../song/status-badge';
import type { SongItemProps } from '../types';

type SongGridCardProps = {
  bestScore?: number;
} & SongItemProps;

export const SongGridCard = memo(
  ({ song, queueStatus, index, isFocused, isSelected, onSelect, bestScore }: SongGridCardProps) => (
    <button
      type="button"
      data-song-index={index}
      aria-pressed={isSelected}
      onClick={() => onSelect(song)}
      className={cn(
        'group flex h-full min-h-32 w-full min-w-0 cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 text-left outline-none transition-colors hover:border-ring hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30',
        (isFocused || isSelected) && 'border-ring bg-muted ring-2 ring-ring/30',
      )}
    >
      <AlbumArt
        song={song}
        className="size-24 rounded-md"
        fallbackIconClassName="size-5"
        showVideoBadge
      />
      <div className="flex min-w-0 flex-1 self-stretch flex-col py-0.5">
        <div className="line-clamp-2 text-sm leading-snug font-semibold">{song.title}</div>
        <p className="mt-1 truncate text-xs text-muted-foreground">{song.artist || '—'}</p>
        <p className="truncate text-xs text-muted-foreground">{song.album || '—'}</p>
        {bestScore === undefined ? null : <Stars score={bestScore} size="sm" className="mt-1" />}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatSeconds(song.duration_secs)}
          </span>
          <div className="flex items-center gap-1">
            <LanguageBadge language={song.language} />
            <NgeBadge song={song} />
            <StatusBadge song={song} queueStatus={queueStatus} />
          </div>
        </div>
      </div>
    </button>
  ),
);
