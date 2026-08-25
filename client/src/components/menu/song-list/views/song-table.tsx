import type { Song } from "@/types/Song";
import { SONG_COLUMNS } from "../song-columns";
import type { SongItemProps } from "../types";
import { SongTableRow } from "./song-table-row";
import { useBestScoresBySongForActiveProfile } from "@/hooks/use-best-scores-by-song";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";

export type SongSortColumn = "song" | "band" | "album" | "duration" | "status";
export type SongSortDirection = "asc" | "desc" | null;

const isSortableColumn = (columnId: string): columnId is SongSortColumn => columnId !== "thumbnail";

interface SongTableProps {
  songs: Song[];
  getItemProps: (song: Song, index: number) => SongItemProps;
  sortColumn: SongSortColumn | null;
  sortDirection: SongSortDirection;
  onSortChange: (column: SongSortColumn) => void;
}

export const SongTable = ({
  songs,
  getItemProps,
  sortColumn,
  sortDirection,
  onSortChange,
}: SongTableProps) => {
  const bestScores = useBestScoresBySongForActiveProfile();

  return (
    <table className="w-full table-fixed border-separate border-spacing-0 text-xs">
      <thead className="song-table__header">
        <tr className="text-left text-muted-foreground">
          {SONG_COLUMNS.map((column) => (
            <th
              key={column.id}
              className={column.thClassName}
              aria-sort={
                sortColumn === column.id
                  ? sortDirection === "asc"
                    ? "ascending"
                    : "descending"
                  : undefined
              }
            >
              {isSortableColumn(column.id) ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1"
                  onClick={() => onSortChange(column.id as SongSortColumn)}
                >
                  {column.header}
                  {sortColumn === column.id && sortDirection === "asc" ? (
                    <ArrowUpIcon aria-hidden="true" className="size-3" />
                  ) : null}
                  {sortColumn === column.id && sortDirection === "desc" ? (
                    <ArrowDownIcon aria-hidden="true" className="size-3" />
                  ) : null}
                </button>
              ) : (
                column.header
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {songs.map((song, index) => (
          <SongTableRow
            key={song.file_hash}
            {...getItemProps(song, index)}
            bestScore={bestScores.get(song.file_hash)}
          />
        ))}
      </tbody>
    </table>
  );
};
