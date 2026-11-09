import { useQuery } from '@tanstack/react-query';
import { SearchIcon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { RoomMember, RoomView as RoomViewState } from '@/bridge/rooms';
import { loadSongs } from '@/bridge/songs';
import { AlbumArt } from '@/features/library/components/song/album-art';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { SONGS } from '@/shared/query-keys';
import { cn } from '@/shared/utils/cn';
import type { LibraryMenuFilters } from '@/types/LibraryMenuFilters';

import type { RoomSession } from '../hooks/use-room';
import { useRoom } from '../hooks/use-room';
import { useRoomLaunch } from '../hooks/use-room-launch';
import { songLabel, useRoomSongs } from '../hooks/use-room-song';
import { denyMessage } from '../lib/deny-message';

const TRACK_FILTERS: LibraryMenuFilters = {
  artist: null,
  album: null,
  playlist: null,
  query: null,
  // Only analyzed songs can be sung, so don't offer the rest.
  status: 'analyzed',
  transcript_source: null,
  search: null,
  folder: null,
};
const SEARCH_PAGE_SIZE = 10;
const MIN_SEARCH_LENGTH = 2;

const slotsOf = (capacity: number): number[] => Array.from({ length: capacity }, (_, slot) => slot);

const readyLabel = (member: RoomMember | undefined): string => {
  if (member === undefined) {
    return '—';
  }

  return member.ready ? t('rooms.room.ready') : t('rooms.room.notReady');
};

const MemberTable = ({ capacity, members }: { capacity: number; members: RoomMember[] }) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>{t('rooms.room.singer')}</TableHead>
        <TableHead className="w-24">{t('rooms.room.role')}</TableHead>
        <TableHead className="w-24">{t('rooms.room.readyColumn')}</TableHead>
        <TableHead className="w-20 text-right">{t('rooms.room.score')}</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {slotsOf(capacity).map((slot) => {
        const member = members.at(slot);

        return (
          <TableRow key={slot} className={cn(member === undefined && 'text-muted-foreground')}>
            <TableCell className="truncate">{member?.name ?? t('rooms.room.emptySlot')}</TableCell>
            <TableCell>{member?.host === true ? t('rooms.room.host') : '—'}</TableCell>
            <TableCell>{readyLabel(member)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {member === undefined ? '—' : member.score}
            </TableCell>
          </TableRow>
        );
      })}
    </TableBody>
  </Table>
);

const RoomStatus = ({
  offsetMs,
  playing,
  startAtMs,
}: {
  offsetMs: number;
  playing: boolean;
  startAtMs: number | null;
}) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);

    return () => clearInterval(timer);
  }, []);

  if (!playing || startAtMs === null) {
    return null;
  }

  const remaining = Math.max(0, Math.ceil((startAtMs - (now + offsetMs)) / 1000));

  return (
    <output className="block text-sm tabular-nums text-muted-foreground">
      {remaining > 0 ? t('rooms.room.countdown', { seconds: remaining }) : t('rooms.room.playing')}
    </output>
  );
};

const TrackPicker = ({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (hash: string, title: string) => void;
}) => {
  const [term, setTerm] = useState('');
  const search = term.trim();
  const enabled = search.length >= MIN_SEARCH_LENGTH && !disabled;

  const { data, isFetching } = useQuery({
    queryKey: [...SONGS, 'rooms-track', search],
    queryFn: () =>
      loadSongs({
        search,
        filters: TRACK_FILTERS,
        sort: null,
        skip: 0,
        take: SEARCH_PAGE_SIZE,
      }),
    enabled,
    // Keep the previous results while the next term loads, so the list does not
    // blink empty on every keystroke.
    keepPreviousData: true,
  });
  const results = data?.processed ?? [];

  return (
    <div className="space-y-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={t('remote.queue.searchPlaceholder')}
          aria-label={t('remote.queue.searchPlaceholder')}
          className="pr-9 pl-8"
          autoComplete="off"
          disabled={disabled}
        />
        {term !== '' && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-1/2 right-0.5 -translate-y-1/2"
            aria-label={t('remote.queue.clearSearch')}
            onClick={() => setTerm('')}
          >
            <XIcon />
          </Button>
        )}
      </div>

      {enabled && (
        <div className="max-h-56 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              {isFetching ? t('common.loading') : t('remote.queue.noResults')}
            </p>
          ) : (
            <ul className="flex flex-col">
              {results.map((song) => (
                <li key={song.file_hash}>
                  <button
                    type="button"
                    aria-label={t('rooms.room.pickTrackFor', { value1: song.title })}
                    className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                    onClick={() => {
                      onPick(song.file_hash, songLabel(song));
                      setTerm('');
                    }}
                  >
                    <AlbumArt song={song} className="size-9 rounded-sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{song.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {song.artist}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

const Waiting = ({ closed, onLeave }: { closed: boolean; onLeave: () => void }) => (
  <div className="flex flex-col items-start gap-2">
    <p className="text-sm text-muted-foreground">
      {closed ? t(denyMessage('not-found')) : t('common.loading')}
    </p>
    <Button variant="outline" onClick={onLeave}>
      {t('rooms.room.back')}
    </Button>
  </div>
);

/** The node names the track; the local library is what actually plays. */
const TrackLine = ({ hash, title }: { hash: string | null; title: string | null }) => {
  const { data: songs } = useRoomSongs(hash === null ? [] : [hash]);
  const local = songs?.at(0);

  if (hash === null) {
    return <p className="text-xs text-muted-foreground">{t('rooms.room.noTrackYet')}</p>;
  }

  return (
    <p className="text-xs text-muted-foreground">
      {local === undefined ? (title ?? t('rooms.room.noTrackYet')) : songLabel(local)}
      <span className="ml-1.5 tabular-nums opacity-60">#{hash.slice(0, 8)}</span>
    </p>
  );
};

const RoomActions = ({
  canStart,
  hasTrack,
  isHost,
  onEnd,
  onLeave,
  onReady,
  onStart,
  playing,
  ready,
}: {
  canStart: boolean;
  hasTrack: boolean | null;
  isHost: boolean;
  onEnd: () => void;
  onLeave: () => void;
  onReady: () => void;
  onStart: () => void;
  playing: boolean;
  ready: boolean;
}) => (
  <div className="flex items-center gap-2">
    <Button variant="outline" onClick={onLeave}>
      {t('rooms.room.leave')}
    </Button>
    {isHost ? (
      <>
        <Button disabled={!canStart} onClick={onStart}>
          {t('rooms.room.start')}
        </Button>
        {playing && (
          <Button variant="outline" onClick={onEnd}>
            {t('rooms.room.end')}
          </Button>
        )}
      </>
    ) : (
      <Button
        variant={ready ? 'outline' : 'default'}
        disabled={hasTrack !== true || playing}
        onClick={onReady}
      >
        {ready ? t('rooms.room.notReady') : t('rooms.room.ready')}
      </Button>
    )}
  </div>
);

const MissingTrackHint = ({ hasTrack, isHost }: { hasTrack: boolean | null; isHost: boolean }) => {
  if (isHost || hasTrack !== false) {
    return null;
  }

  return <p className="text-xs text-muted-foreground">{t('rooms.room.missingTrack')}</p>;
};

/** Launches this singer's playback when the room starts a track. */
const RoomSessionBridge = ({
  me,
  offsetMs,
  session,
  state,
}: {
  me: RoomMember | null;
  offsetMs: number;
  session: RoomSession;
  state: RoomViewState;
}) => {
  useRoomLaunch({
    session,
    trackHash: state.track?.hash ?? null,
    startAtMs: state.startAtMs,
    memberName: me?.name ?? '',
    offsetMs,
  });

  return null;
};

const RoomBody = ({
  denied,
  hasTrack,
  isHost,
  offsetMs,
  onPick,
  playing,
  state,
}: {
  denied: string | null;
  hasTrack: boolean | null;
  isHost: boolean;
  offsetMs: number;
  onPick: (hash: string, title: string) => void;
  playing: boolean;
  state: RoomViewState;
}) => (
  <div className="flex flex-col gap-4">
    <MemberTable capacity={state.capacity} members={state.members} />

    {denied !== null && (
      <p className="text-xs text-destructive" role="alert">
        {t(denyMessage(denied))}
      </p>
    )}

    <RoomStatus offsetMs={offsetMs} playing={playing} startAtMs={state.startAtMs} />

    <MissingTrackHint hasTrack={hasTrack} isHost={isHost} />

    {isHost && <TrackPicker disabled={playing} onPick={onPick} />}
  </div>
);

export function RoomView({ onLeave, session }: { onLeave: () => void; session: RoomSession }) {
  const { closed, denied, hasTrack, isHost, me, offsetMs, send, state } = useRoom(session);

  if (state === null) {
    return <Waiting closed={closed} onLeave={onLeave} />;
  }

  const playing = state.phase === 'playing';
  const ready = me?.ready === true;
  const canStart = isHost && state.track !== null && state.members.every((member) => member.ready);

  return (
    <div className="flex flex-col gap-4">
      <RoomSessionBridge me={me} offsetMs={offsetMs} session={session} state={state} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-medium">{state.name}</h2>
          <TrackLine hash={state.track?.hash ?? null} title={state.track?.title ?? null} />
        </div>
        <RoomActions
          canStart={canStart}
          hasTrack={hasTrack}
          isHost={isHost}
          playing={playing}
          ready={ready}
          onLeave={onLeave}
          onStart={() => send({ type: 'room.start' })}
          onEnd={() => send({ type: 'room.end' })}
          onReady={() => send({ type: 'room.ready', ready: !ready })}
        />
      </div>

      <RoomBody
        denied={denied}
        hasTrack={hasTrack}
        isHost={isHost}
        offsetMs={offsetMs}
        playing={playing}
        state={state}
        onPick={(hash, title) => send({ type: 'room.track', hash, title })}
      />
    </div>
  );
}
