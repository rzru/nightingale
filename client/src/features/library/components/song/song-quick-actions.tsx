import {
  ArrowDownToLineIcon,
  ArrowUpToLineIcon,
  AudioLinesIcon,
  ListPlusIcon,
  PencilLineIcon,
  PlayIcon,
  UserIcon,
  UsersIcon,
} from 'lucide-react';
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui';

import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import type { QueuedStatus } from '@/types/QueuedStatus';
import type { Song } from '@/types/Song';

import { getSongStatusInfo } from './song-status';

type SongQuickActionsProps = {
  song: Song;
  queueStatus?: QueuedStatus;
  addingToQueue: boolean;
  onAddToQueue: (song: Song, position: 'top' | 'bottom') => void;
  onAnalyze: (song: Song) => void;
  onPlay: (song: Song) => void;
  onPlayMultiplayer: (song: Song) => void;
  onProvideLyrics: (song: Song) => void;
};

const menuContentClassName =
  'z-50 min-w-36 rounded-lg bg-popover p-1 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95';
const menuItemClassName =
  'flex min-h-7 cursor-pointer items-center gap-2 rounded-md px-2 py-1 outline-none select-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0';

export function SongQuickActions({
  song,
  queueStatus,
  addingToQueue,
  onAddToQueue,
  onAnalyze,
  onPlay,
  onPlayMultiplayer,
  onProvideLyrics,
}: SongQuickActionsProps) {
  const status = getSongStatusInfo(song.is_analyzed, queueStatus);
  const analysisBusy = queueStatus === 'Queued' || status.isAnalyzing === true;
  const disabled = status.isReady !== true;

  if (!song.is_analyzed) {
    return (
      <fieldset className="inline-flex items-center rounded-sm ring-1 ring-border">
        <legend className="sr-only">
          {t('library.song.songQuickActions.actionsForValue1', { value1: song.title })}
        </legend>
        <ContextMenuPrimitive.Root>
          <ContextMenuPrimitive.Trigger asChild>
            <Button
              variant="secondary"
              size="icon-sm"
              className="rounded-sm hover:bg-primary/20 hover:text-primary"
              disabled={analysisBusy}
              aria-busy={analysisBusy}
              onClick={(event) => {
                event.stopPropagation();
                onAnalyze(song);
              }}
              aria-haspopup="menu"
              aria-label={t('library.quickActions.analyzeLabel', { title: song.title })}
              title={t('library.song.songQuickActions.analyzeRightClickForOptions')}
            >
              <AudioLinesIcon />
            </Button>
          </ContextMenuPrimitive.Trigger>
          <ContextMenuPrimitive.Portal>
            <ContextMenuPrimitive.Content
              className={menuContentClassName}
              onClick={(event) => event.stopPropagation()}
            >
              <ContextMenuPrimitive.Item
                className={menuItemClassName}
                onSelect={() => onAnalyze(song)}
              >
                <AudioLinesIcon />
                {t('library.song.songQuickActions.analyzeSong')}
              </ContextMenuPrimitive.Item>
              {song.transcript_source !== 'Usdx' ? (
                <ContextMenuPrimitive.Item
                  className={menuItemClassName}
                  onSelect={() => onProvideLyrics(song)}
                >
                  <PencilLineIcon />
                  {t('library.song.songQuickActions.provideLyrics')}
                </ContextMenuPrimitive.Item>
              ) : null}
            </ContextMenuPrimitive.Content>
          </ContextMenuPrimitive.Portal>
        </ContextMenuPrimitive.Root>
      </fieldset>
    );
  }

  return (
    <fieldset className="inline-flex items-center rounded-md ring-1 ring-border">
      <legend className="sr-only">
        {t('library.song.songQuickActions.actionsForValue1', { value1: song.title })}
      </legend>
      <ContextMenuPrimitive.Root>
        <ContextMenuPrimitive.Trigger asChild>
          <Button
            variant="secondary"
            size="icon-sm"
            className="rounded-r-none hover:bg-primary/20 hover:text-primary"
            disabled={disabled || addingToQueue}
            onClick={(event) => {
              event.stopPropagation();
              onAddToQueue(song, 'bottom');
            }}
            aria-haspopup="menu"
            aria-label={t('library.quickActions.queueLabel', { title: song.title })}
            title={t('library.song.songQuickActions.addToQueueRightClickForPosition')}
          >
            <ListPlusIcon />
          </Button>
        </ContextMenuPrimitive.Trigger>
        <ContextMenuPrimitive.Portal>
          <ContextMenuPrimitive.Content
            className={menuContentClassName}
            onClick={(event) => event.stopPropagation()}
          >
            <ContextMenuPrimitive.Item
              className={menuItemClassName}
              onSelect={() => onAddToQueue(song, 'top')}
            >
              <ArrowUpToLineIcon />
              {t('library.song.songQuickActions.addToTop')}
            </ContextMenuPrimitive.Item>
            <ContextMenuPrimitive.Item
              className={menuItemClassName}
              onSelect={() => onAddToQueue(song, 'bottom')}
            >
              <ArrowDownToLineIcon />
              {t('library.song.songQuickActions.addToBottom')}
            </ContextMenuPrimitive.Item>
          </ContextMenuPrimitive.Content>
        </ContextMenuPrimitive.Portal>
      </ContextMenuPrimitive.Root>

      <ContextMenuPrimitive.Root>
        <ContextMenuPrimitive.Trigger asChild>
          <Button
            size="icon-sm"
            className="rounded-l-none hover:bg-primary/70"
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              onPlay(song);
            }}
            aria-haspopup="menu"
            aria-label={t('library.quickActions.playLabel', { title: song.title })}
            title={t('library.song.songQuickActions.playRightClickForMode')}
          >
            <PlayIcon />
          </Button>
        </ContextMenuPrimitive.Trigger>
        <ContextMenuPrimitive.Portal>
          <ContextMenuPrimitive.Content
            className={menuContentClassName}
            onClick={(event) => event.stopPropagation()}
          >
            <ContextMenuPrimitive.Item className={menuItemClassName} onSelect={() => onPlay(song)}>
              <UserIcon />
              {t('library.song.songQuickActions.singleplayer')}
            </ContextMenuPrimitive.Item>
            <ContextMenuPrimitive.Item
              className={menuItemClassName}
              onSelect={() => onPlayMultiplayer(song)}
            >
              <UsersIcon />
              {t('library.song.songQuickActions.multiplayer')}
            </ContextMenuPrimitive.Item>
          </ContextMenuPrimitive.Content>
        </ContextMenuPrimitive.Portal>
      </ContextMenuPrimitive.Root>
    </fieldset>
  );
}
