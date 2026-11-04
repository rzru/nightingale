import { ListMusicIcon, QrCodeIcon, XIcon } from 'lucide-react';
import { useState } from 'react';

import type { PlaybackQueueEntry } from '@/bridge/playback-queue';
import type { PlaybackPlayer } from '@/bridge/playback-session';
import { useSongDetailsNav } from '@/features/library/components/song-details/use-song-details-nav';
import { QueueList } from '@/features/playback-queue/components/queue-list';
import { QueuePlaybackButtons } from '@/features/playback-queue/components/queue-playback-buttons';
import {
  useClearPlaybackQueue,
  useMovePlaybackQueueEntry,
  useRemovePlaybackQueueEntry,
  useStartNextPlaybackQueueSong,
} from '@/features/playback-queue/use-playback-queue';
import { MultiplayerSetupDialog } from '@/features/playback/components/dialogs/multiplayer-setup';
import { RemoteControlDialog } from '@/features/remote/remote-control-dialog';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';

type QueueSidebarProps = {
  entries: PlaybackQueueEntry[];
  onClose: () => void;
};

const queuePlaybackDisabled = (
  entryCount: number,
  preparing: boolean,
  clearing: boolean,
): boolean => entryCount === 0 || preparing || clearing;

export function QueueSidebar({ entries, onClose }: QueueSidebarProps) {
  const { isPreparing, playNext } = useStartNextPlaybackQueueSong(entries);
  const { mutate: move, isLoading: reordering } = useMovePlaybackQueueEntry();
  const { mutate: remove, isLoading: removing } = useRemovePlaybackQueueEntry();
  const { mutate: clear, isLoading: clearing } = useClearPlaybackQueue();
  const { detailsRef, closeDetails } = useSongDetailsNav(onClose);
  const [multiplayerOpen, setMultiplayerOpen] = useState(false);
  const playbackDisabled =
    queuePlaybackDisabled(entries.length, isPreparing, clearing) || reordering;

  return (
    <aside
      ref={detailsRef}
      className="flex min-h-0 min-w-0 flex-1 flex-col border-l bg-background [&_[data-song-details-focused=true]]:z-10 [&_[data-song-details-focused=true]]:ring-2 [&_[data-song-details-focused=true]]:ring-primary xl:w-96 xl:flex-none"
      aria-label={t('playbackQueue.queueSidebar.playbackQueue')}
    >
      <header className="flex items-center gap-3 border-b p-3">
        <ListMusicIcon className="size-5" />
        <h2 className="min-w-0 flex-1 text-sm font-semibold">
          {t('playbackQueue.queueSidebar.playbackQueue2')}
        </h2>
        <RemoteControlDialog>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('remote.control.openLabel')}
            title={t('remote.control.openLabel')}
          >
            <QrCodeIcon />
          </Button>
        </RemoteControlDialog>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={closeDetails}
          aria-label={t('playbackQueue.queueSidebar.closeQueue')}
        >
          <XIcon />
        </Button>
      </header>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
        <QueueList
          entries={entries}
          disabled={reordering || removing || clearing}
          onMove={move}
          onRemove={remove}
        />
      </div>

      <footer
        className="flex gap-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        data-song-details-nav-group
      >
        <QueuePlaybackButtons
          label={t('playbackQueue.queueSidebar.playQueue')}
          disabled={playbackDisabled}
          preparing={isPreparing}
          entries={entries.length}
          clearing={clearing}
          onPlay={() => playNext()}
          onPlayMultiplayer={() => setMultiplayerOpen(true)}
          onClear={() => clear()}
        />
      </footer>

      <MultiplayerSetupDialog
        open={multiplayerOpen}
        onOpenChange={setMultiplayerOpen}
        onStart={(players: PlaybackPlayer[]) => playNext(players)}
        queuePlayback
      />
    </aside>
  );
}
