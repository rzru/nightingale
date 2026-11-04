import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SearchIcon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  requestPlaybackControl,
  type PlaybackControl,
  type PlaybackProgress,
} from '@/bridge/playback-remote';
import {
  loadPlaybackStatus,
  onPlaybackStatusChanged,
  requestPlaybackCommand,
  requestQueuePlayback,
} from '@/bridge/playback-status';
import { loadSongs } from '@/bridge/songs';
import { AlbumArt } from '@/features/library/components/song/album-art';
import { QueueList } from '@/features/playback-queue/components/queue-list';
import { QueuePlaybackButtons } from '@/features/playback-queue/components/queue-playback-buttons';
import {
  useAddPlaybackQueueEntry,
  useClearPlaybackQueue,
  useMovePlaybackQueueEntry,
  usePlaybackQueueQuery,
  useRemovePlaybackQueueEntry,
} from '@/features/playback-queue/use-playback-queue';
import { MultiplayerSetupDialog } from '@/features/playback/components/dialogs/multiplayer-setup';
import { PlaybackActionButtons } from '@/features/playback/components/playback-action-buttons';
import { playbackActions } from '@/features/playback/lib/playback-actions';
import { useRemotePlayback, useRemoteTransport } from '@/features/remote/hooks/use-remote-playback';
import { RemotePlaybackSettings } from '@/features/remote/remote-playback-settings';
import { RemoteTransportBar } from '@/features/remote/remote-transport-bar';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Separator } from '@/shared/components/ui/separator';
import { PLAYBACK_STATUS, SONGS } from '@/shared/query-keys';
import type { LibraryMenuFilters } from '@/types/LibraryMenuFilters';
import type { LoadSongsParams } from '@/types/LoadSongsParams';

const REMOTE_FILTERS: LibraryMenuFilters = {
  artist: null,
  album: null,
  playlist: null,
  query: null,
  // Only analyzed songs can be queued, so don't offer the rest.
  status: 'analyzed',
  transcript_source: null,
  search: null,
  folder: null,
};
const PAGE_SIZE = 25;
const MIN_SEARCH_LENGTH = 2;

/**
 * The host only offers these while they apply, so the row simply mirrors the
 * published progress next to the shared playback actions.
 */
function RemoteSkipButtons({
  progress,
  disabled,
  onControl,
}: {
  progress: PlaybackProgress | undefined;
  disabled: boolean;
  onControl: (control: PlaybackControl) => void;
}) {
  const skipIntro = progress?.skipIntro === true;
  const skipOutro = progress?.skipOutro === true;

  if (!skipIntro && !skipOutro) {
    return null;
  }

  return (
    <>
      {skipIntro ? (
        <Button
          variant="outline"
          disabled={disabled}
          className="h-11 flex-1"
          onClick={() => onControl({ type: 'skip-intro' })}
        >
          {t('playback.playbackHud.skipIntro')}
        </Button>
      ) : null}
      {skipOutro ? (
        <Button
          variant="outline"
          disabled={disabled}
          className="h-11 flex-1"
          onClick={() => onControl({ type: 'skip-outro' })}
        >
          {t('playback.playbackHud.skipOutro')}
        </Button>
      ) : null}
    </>
  );
}

/**
 * Playback runs on the host, so these controls only send requests. The action
 * list is the shared one, the transport mirrors the host HUD, and the settings
 * panel edits the host's live playback state.
 */
function PlaybackControl({ entryCount }: { entryCount: number }) {
  const queryClient = useQueryClient();
  const { data: status } = useQuery({ queryKey: PLAYBACK_STATUS, queryFn: loadPlaybackStatus });
  const { progress, options } = useRemotePlayback();
  const { mutate, isLoading } = useMutation({ mutationFn: requestPlaybackCommand });
  const { mutate: sendControl } = useMutation({ mutationFn: requestPlaybackControl });
  const { mutate: startQueue, isLoading: starting } = useMutation({
    mutationFn: requestQueuePlayback,
  });
  const { mutate: clear, isLoading: clearing } = useClearPlaybackQueue();
  const [multiplayerOpen, setMultiplayerOpen] = useState(false);
  const runControl = (control: PlaybackControl) => sendControl(control);
  const transport = useRemoteTransport(progress, (seconds) =>
    runControl({ type: 'seek', positionMs: Math.round(seconds * 1000) }),
  );

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void onPlaybackStatusChanged((next) => {
      queryClient.setQueryData(PLAYBACK_STATUS, next);
    }).then((fn) => {
      if (cancelled) {
        fn();
        return undefined;
      }
      unlisten = fn;
      return undefined;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [queryClient]);

  if (status?.active !== true) {
    const disabled = starting || clearing || entryCount === 0 || status === undefined;
    return (
      <>
        <div className="flex gap-2">
          <QueuePlaybackButtons
            label={t('remote.queue.play')}
            large
            disabled={disabled}
            preparing={starting}
            entries={entryCount}
            clearing={clearing}
            onPlay={() => startQueue([])}
            onPlayMultiplayer={() => setMultiplayerOpen(true)}
            onClear={() => clear()}
          />
        </div>
        <MultiplayerSetupDialog
          open={multiplayerOpen}
          onOpenChange={setMultiplayerOpen}
          onStart={startQueue}
          queuePlayback
          remote
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {options === undefined || options.themeKey === '' ? null : (
        <>
          <RemotePlaybackSettings options={options} onControl={runControl} />
          <Separator className="bg-border/60" />
        </>
      )}

      <RemoteTransportBar transport={transport} />

      <Separator className="bg-border/60" />

      <PlaybackActionButtons
        actions={playbackActions(status)}
        onCommand={(command) => mutate(command)}
        open={false}
        disabled={isLoading}
        className="w-full"
        buttonClassName="h-11 flex-1"
        trailing={
          <RemoteSkipButtons progress={progress} disabled={isLoading} onControl={runControl} />
        }
      />
    </div>
  );
}

/** Search + add. Owns its term so typing never re-renders the queue. */
function RemoteSearch() {
  const { mutate: add, isLoading: adding } = useAddPlaybackQueueEntry();
  const [term, setTerm] = useState('');
  const search = term.trim();
  const enabled = search.length >= MIN_SEARCH_LENGTH;

  const { data: songs, isFetching } = useQuery({
    queryKey: [...SONGS, 'remote-queue', search],
    queryFn: () => {
      const params: LoadSongsParams = {
        search,
        filters: REMOTE_FILTERS,
        sort: null,
        skip: 0,
        take: PAGE_SIZE,
      };
      return loadSongs(params);
    },
    enabled,
    // Keep the previous page on screen while the next term loads; otherwise the
    // list empties and repaints on every keystroke.
    keepPreviousData: true,
  });

  const results = songs?.processed ?? [];

  return (
    <>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={t('remote.queue.searchPlaceholder')}
          aria-label={t('remote.queue.searchPlaceholder')}
          className="h-9 pr-10 pl-8 text-base"
          type="search"
          autoComplete="off"
        />
        {term === '' ? null : (
          <Button
            variant="ghost"
            size="icon-lg"
            className="absolute top-1/2 right-0 -translate-y-1/2"
            aria-label={t('remote.queue.clearSearch')}
            title={t('remote.queue.clearSearch')}
            onClick={() => setTerm('')}
          >
            <XIcon />
          </Button>
        )}
      </div>

      {enabled ? (
        <div className="max-h-56 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">
              {isFetching ? t('common.loading') : t('remote.queue.noResults')}
            </p>
          ) : (
            <ul className="flex flex-col">
              {results.map((song) => (
                <li key={song.file_hash}>
                  <button
                    type="button"
                    disabled={adding}
                    aria-label={t('remote.queue.addLabel', { value1: song.title })}
                    onClick={() =>
                      add(
                        {
                          song,
                          tempo: song.tempo,
                          keyOffset: song.key_offset,
                          position: 'bottom',
                        },
                        { onSuccess: () => setTerm('') },
                      )
                    }
                    className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none active:bg-accent disabled:pointer-events-none disabled:opacity-50"
                  >
                    <AlbumArt song={song} className="size-9 rounded-sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{song.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{song.artist}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </>
  );
}

/**
 * The phone surface. Deliberately narrow: queue, search, and a play/pause
 * request. Nothing here plays audio on the phone itself.
 */
export const RemoteQueuePage = () => {
  const { data: entries = [] } = usePlaybackQueueQuery();
  const { mutate: move, isLoading: reordering } = useMovePlaybackQueueEntry();
  const { mutate: remove, isLoading: removing } = useRemovePlaybackQueueEntry();

  // The token only has to be in the URL once; the server turns it into a
  // cookie so it does not linger in the address bar or the browser history.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('t')) {
      url.searchParams.delete('t');
      window.history.replaceState(null, '', url);
    }
  }, []);

  return (
    <div className="mx-auto flex h-dvh max-w-xl flex-col overflow-x-hidden">
      <div className="flex flex-col gap-2 border-b px-4 py-3">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">{t('remote.queue.title')}</h1>
          <span className="text-xs text-muted-foreground">
            {t('remote.queue.count', { value1: entries.length })}
          </span>
        </header>

        <RemoteSearch />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <QueueList
          entries={entries}
          disabled={reordering || removing}
          onMove={move}
          onRemove={remove}
          dragFromRow
        />
      </div>

      <div className="shrink-0 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <PlaybackControl entryCount={entries.length} />
      </div>
    </div>
  );
};
