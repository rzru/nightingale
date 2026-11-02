import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react';

import { useBestScoresBySongForActiveProfile } from '@/features/profiles/hooks/use-best-scores-by-song';
import { cn } from '@/shared/utils/cn';
import type { Song } from '@/types/Song';
import type { SongSort } from '@/types/SongSort';
import type { SongSortColumn } from '@/types/SongSortColumn';

import { songKey } from '../../song/song-key';
import { SONG_COLUMNS, type SongColumn } from '../song-columns';
import type { SongItemProps, SongListActions } from '../types';
import { SongTableRow } from './song-table-row';

type SongTableProps = {
  songs: Song[];
  sort: readonly SongSort[];
  sortingDisabled: boolean;
  onSort: (column: SongSortColumn) => void;
  getItemProps: (song: Song, index: number) => SongItemProps;
  actions: SongListActions;
};

type SongTableHeaderProps = {
  column: SongColumn;
  sort: readonly SongSort[];
  sortingDisabled: boolean;
  onSort: (column: SongSortColumn) => void;
};

const SongTableHeader = ({ column, sort, sortingDisabled, onSort }: SongTableHeaderProps) => {
  const sortColumn = column.sortColumn;
  if (sortColumn === undefined) {
    return <th className={column.thClassName}>{column.header}</th>;
  }

  const sortIndex = sort.findIndex(({ column: sortedColumn }) => sortedColumn === sortColumn);
  const activeDirection = sortIndex === -1 ? undefined : sort[sortIndex].direction;
  const priority = sortIndex + 1;
  let icon = (
    <ArrowUpDownIcon className="size-3 shrink-0 translate-y-px opacity-40" aria-hidden="true" />
  );
  if (activeDirection === 'ascending') {
    icon = <ArrowUpIcon className="size-3 shrink-0 translate-y-px" aria-hidden="true" />;
  } else if (activeDirection === 'descending') {
    icon = <ArrowDownIcon className="size-3 shrink-0 translate-y-px" aria-hidden="true" />;
  }

  return (
    <th className={column.thClassName} aria-sort={sortIndex === 0 ? activeDirection : undefined}>
      <button
        type="button"
        disabled={sortingDisabled}
        className={cn(
          'flex w-full items-center gap-0.5 text-left outline-none hover:text-foreground focus-visible:text-foreground disabled:cursor-wait',
          column.id === 'status' && 'justify-end',
        )}
        onClick={() => onSort(sortColumn)}
      >
        {column.header}
        <span className="inline-flex items-start" aria-hidden="true">
          {icon}
          {activeDirection && (
            <sup className="-ml-0.5 text-[0.45rem] leading-none tabular-nums">{priority}</sup>
          )}
        </span>
        {activeDirection && (
          <span className="sr-only">
            , sorted {activeDirection}, priority {priority}
          </span>
        )}
      </button>
    </th>
  );
};

export const SongTable = ({
  songs,
  sort,
  sortingDisabled,
  onSort,
  getItemProps,
  actions,
}: SongTableProps) => {
  const bestScores = useBestScoresBySongForActiveProfile();

  return (
    <table className="w-full table-fixed border-separate border-spacing-0 text-xs">
      <thead className="song-table-header">
        <tr className="text-left text-muted-foreground">
          {SONG_COLUMNS.map((column) => (
            <SongTableHeader
              key={column.id}
              column={column}
              sort={sort}
              sortingDisabled={sortingDisabled}
              onSort={onSort}
            />
          ))}
        </tr>
      </thead>
      <tbody>
        {songs.map((song, index) => (
          <SongTableRow
            key={songKey(song)}
            {...getItemProps(song, index)}
            actions={actions}
            bestScore={bestScores.get(song.file_hash)}
          />
        ))}
      </tbody>
    </table>
  );
};
