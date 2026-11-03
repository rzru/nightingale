import { useQuery } from '@tanstack/react-query';
import { TrophyIcon } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { loadSongsByHashes } from '@/bridge/songs';
import { useDialog, type DialogMode } from '@/features/menu/hooks/use-dialog';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import { topScoresForSong } from '@/features/playback/utils/result';
import { useProfiles } from '@/features/profiles/queries/use-profiles';
import { formatDate, t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { cn } from '@/shared/utils/cn';
import type { ScoreRecord } from '@/types/ScoreRecord';
import type { Song } from '@/types/Song';

const TOP_LIMIT = 10;
const RING = 'ring-2 ring-primary';
const NO_FOCUS_RING = 'focus-visible:ring-0 focus-visible:border-transparent';
const EMPTY_SCORES: ScoreRecord[] = [];

function AchievedAt({ playedAt }: { playedAt: bigint }) {
  const date = new Date(Number(playedAt) * 1000);

  return Number.isNaN(date.getTime()) ? (
    '—'
  ) : (
    <time
      className="block truncate text-[10px] text-muted-foreground"
      dateTime={date.toISOString()}
    >
      {formatDate(date, { dateStyle: 'short', timeStyle: 'short' })}
    </time>
  );
}

function topScoreRecords(records: ScoreRecord[]): ScoreRecord[] {
  return records
    .map((record, index) => ({ record, index }))
    .toSorted((a, b) => b.record.score - a.record.score || a.index - b.index)
    .slice(0, TOP_LIMIT)
    .map(({ record }) => record);
}

type SongLeaderboardMode = Extract<DialogMode, { mode: 'song-leaderboard' }>;
type LeaderboardMode = 'leaderboards' | SongLeaderboardMode;

function isLeaderboardMode(mode: DialogMode): mode is LeaderboardMode {
  return (
    mode === 'leaderboards' ||
    (typeof mode === 'object' && mode !== null && mode.mode === 'song-leaderboard')
  );
}

function sameLeaderboardMode(left: LeaderboardMode, right: LeaderboardMode): boolean {
  if (left === 'leaderboards' || right === 'leaderboards') {
    return left === right;
  }

  return left.song.file_hash === right.song.file_hash;
}

function useRetainedLeaderboardMode(mode: DialogMode): LeaderboardMode {
  const [retainedMode, setRetainedMode] = useState<LeaderboardMode>('leaderboards');

  if (isLeaderboardMode(mode) && !sameLeaderboardMode(mode, retainedMode)) {
    setRetainedMode(mode);
  }

  return isLeaderboardMode(mode) ? mode : retainedMode;
}

type LeaderboardSongNameProps = {
  song?: Song;
  loading: boolean;
  songHash: string;
};

function LeaderboardSongName({ song, loading, songHash }: LeaderboardSongNameProps) {
  if (song) {
    return (
      <div className="min-w-0">
        <div className="truncate font-medium">{song.title || songHash}</div>
        <div className="truncate text-muted-foreground">
          {song.artist || t('profiles.leaderboards.unknownArtist')}
        </div>
      </div>
    );
  }

  if (loading) {
    return t('common.loading');
  }

  return t('profiles.leaderboards.unknownSong', { hash: songHash.slice(0, 8) });
}

type LeaderboardBoardProps = {
  empty: boolean;
  global: boolean;
  globalBoard: ScoreRecord[];
  songBoard: ScoreRecord[];
  songs: Map<string, Song> | undefined;
  loading: boolean;
};

const LeaderboardBoard = ({
  empty,
  global,
  globalBoard,
  songBoard,
  songs,
  loading,
}: LeaderboardBoardProps) => {
  if (empty) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t('profiles.leaderboards.noScoresYet')}
      </p>
    );
  }
  if (!global) {
    return (
      <Table className="table-fixed">
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-9 w-8 px-1 text-xs">#</TableHead>
            <TableHead className="h-9 text-xs">{t('profiles.leaderboards.profile')}</TableHead>
            <TableHead className="h-9 w-28 text-right text-xs">
              {t('profiles.leaderboards.score')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {songBoard.map(({ profile, score, played_at: playedAt }, index) => (
            <TableRow key={profile} className="hover:bg-transparent">
              <TableCell className="px-1 py-2 text-xs tabular-nums">{index + 1}</TableCell>
              <TableCell className="max-w-0 py-2 text-xs" title={profile}>
                <div className="truncate">{profile}</div>
                <AchievedAt playedAt={playedAt} />
              </TableCell>
              <TableCell className="py-2 text-right text-xs font-medium tabular-nums">
                {score}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <Table className="table-fixed">
      <TableHeader className="sticky top-0 z-10 bg-background">
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-9 w-8 px-1 text-xs">#</TableHead>
          <TableHead className="h-9 text-xs">{t('profiles.leaderboards.song')}</TableHead>
          <TableHead className="h-9 w-[28%] text-xs">
            {t('profiles.leaderboards.profile')}
          </TableHead>
          <TableHead className="h-9 w-16 text-right text-xs">
            {t('profiles.leaderboards.score')}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {globalBoard.map((record, index) => (
          <TableRow
            key={`${record.song_hash}-${record.profile}-${record.score}-${record.played_at}`}
            className="hover:bg-transparent"
          >
            <TableCell className="px-1 py-2 text-xs tabular-nums">{index + 1}</TableCell>
            <TableCell className="max-w-0 py-2 text-xs">
              <LeaderboardSongName
                song={songs?.get(record.song_hash)}
                loading={loading}
                songHash={record.song_hash}
              />
            </TableCell>
            <TableCell className="max-w-0 py-2 text-xs" title={record.profile}>
              <div className="truncate">{record.profile}</div>
              <AchievedAt playedAt={record.played_at} />
            </TableCell>
            <TableCell className="py-2 text-right text-xs font-medium tabular-nums">
              {record.score}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

const LeaderboardHeading = ({
  global,
  title,
  artist,
}: {
  global: boolean;
  title: string | undefined;
  artist: string;
}) => (
  <DialogHeader className="shrink-0 gap-1 border-b p-4 pr-10">
    <DialogTitle className="flex min-w-0 items-start gap-2 text-base">
      <TrophyIcon className="size-4 shrink-0 self-center text-primary" />
      <span className="min-w-0">
        <span className="block truncate">{global ? t('profiles.leaderboards.title') : title}</span>
        {!global && (
          <span className="block truncate text-xs font-normal text-muted-foreground">{artist}</span>
        )}
      </span>
    </DialogTitle>
    <DialogDescription className={cn(!global && 'sr-only')}>
      {t(
        global
          ? 'profiles.leaderboards.globalDescription'
          : 'profiles.leaderboards.songDescription',
      )}
    </DialogDescription>
  </DialogHeader>
);

const displayedLeaderboard = (mode: LeaderboardMode) => ({
  global: mode === 'leaderboards',
  songMode: typeof mode === 'object' ? mode : null,
});

const leaderboardSongCopy = (song: Song | undefined) => ({
  title: song?.title,
  artist:
    song === undefined || song.artist === ''
      ? t('profiles.leaderboards.unknownArtist')
      : song.artist,
});

const songLeaderboard = (scores: ScoreRecord[], songHash: string | undefined) =>
  typeof songHash === 'string' && songHash !== ''
    ? topScoresForSong(scores, songHash, TOP_LIMIT)
    : [];

const leaderboardEmpty = (
  global: boolean,
  globalBoard: readonly ScoreRecord[],
  songBoard: readonly unknown[],
): boolean => (global ? globalBoard : songBoard).length === 0;

export const LeaderboardsDialog = () => {
  const { mode, close } = useDialog();
  const { data: profiles } = useProfiles();
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const displayedMode = useRetainedLeaderboardMode(mode);
  const open = isLeaderboardMode(mode);
  const { global: globalOpen, songMode } = displayedLeaderboard(displayedMode);
  const scores = profiles?.scores ?? EMPTY_SCORES;

  const globalBoard = useMemo(() => topScoreRecords(scores), [scores]);
  const songHash = songMode?.song.file_hash;
  const songBoard = songLeaderboard(scores, songHash);
  const targetSongHashes = useMemo(
    () => [...new Set(globalBoard.map((record) => record.song_hash))].toSorted(),
    [globalBoard],
  );
  const { data: leaderboardSongs, isLoading: songsLoading } = useQuery({
    queryKey: ['leaderboard-songs', targetSongHashes],
    queryFn: async () => {
      const songs = await loadSongsByHashes(targetSongHashes);
      return new Map(songs.map((song) => [song.file_hash, song]));
    },
    enabled: globalOpen && targetSongHashes.length > 0,
  });

  const { focusedIndex, focusSegment } = useDialogNav({
    open,
    itemCount: 1,
    containerRef,
    onBack: close,
    onAction: (_segment, _slot, action) => {
      if (!action.up && !action.down) {
        return false;
      }
      scrollRef.current?.scrollBy({ top: action.down ? 48 : -48, behavior: 'smooth' });
      return true;
    },
  });

  const { title: songTitle, artist: songArtist } = leaderboardSongCopy(songMode?.song);
  const boardEmpty = leaderboardEmpty(globalOpen, globalBoard, songBoard);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && close()}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          'flex max-h-[calc(100svh-2rem)] min-h-0 flex-col gap-0 overflow-hidden p-0',
          globalOpen ? 'sm:max-w-2xl' : 'sm:max-w-lg',
        )}
      >
        <div ref={containerRef} className="contents">
          <LeaderboardHeading global={globalOpen} title={songTitle} artist={songArtist} />

          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overscroll-contain overflow-auto px-2 sm:px-4"
          >
            <LeaderboardBoard
              empty={boardEmpty}
              global={globalOpen}
              globalBoard={globalBoard}
              songBoard={songBoard}
              songs={leaderboardSongs}
              loading={songsLoading}
            />
          </div>

          <DialogFooter className="shrink-0 border-t p-3">
            <Button
              variant="outline"
              onClick={close}
              onMouseEnter={() => focusSegment(0)}
              className={cn(NO_FOCUS_RING, open && focusedIndex === 0 && RING)}
            >
              {t('common.actions.close')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};
