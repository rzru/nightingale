import { PlayIcon, Trash2Icon, UsersIcon } from 'lucide-react';
import { useState } from 'react';

import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import { t, tp } from '@/i18n';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/components/ui/alert-dialog';
import { Button } from '@/shared/components/ui/button';
import { Spinner } from '@/shared/components/ui/spinner';
import { cn } from '@/shared/utils/cn';

type ClearQueueButtonProps = {
  entries: number;
  disabled: boolean;
  clearing: boolean;
  blockClass: string;
  onClear: () => void;
};

const dialogFocusClass = (open: boolean, focusedIndex: number, index: number): string =>
  cn(
    'focus-visible:border-transparent focus-visible:ring-0',
    open && focusedIndex === index && 'ring-2 ring-primary',
  );

function ClearQueueButton({
  entries,
  disabled,
  clearing,
  blockClass,
  onClear,
}: ClearQueueButtonProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const confirmClear = () => {
    onClear();
    close();
  };
  const { focusedIndex } = useDialogNav({
    open,
    itemCount: 2,
    onConfirm: (index) => (index === 0 ? close() : confirmClear()),
    onBack: close,
  });

  return (
    <AlertDialog open={open} onOpenChange={(next) => setOpen(next)}>
      <AlertDialogTrigger asChild>
        <Button
          variant="destructive"
          size="icon-lg"
          className={blockClass}
          disabled={disabled || clearing}
          aria-label={t('playbackQueue.queueSidebar.clearPlaybackQueue')}
          title={t('playbackQueue.queueSidebar.clearQueue')}
        >
          <Trash2Icon />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent onEscapeKeyDown={(event) => event.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('playbackQueue.queueSidebar.clearPlaybackQueue2')}</AlertDialogTitle>
          <AlertDialogDescription>
            {tp('playbackQueue.clearDescription', entries)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className={dialogFocusClass(open, focusedIndex, 0)} onClick={close}>
            {t('common.actions.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className={dialogFocusClass(open, focusedIndex, 1)}
            onClick={confirmClear}
          >
            {t('playbackQueue.queueSidebar.clearQueue')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type QueuePlaybackButtonsProps = {
  label: string;
  disabled: boolean;
  preparing: boolean;
  entries: number;
  clearing: boolean;
  onPlay: () => void;
  onPlayMultiplayer: () => void;
  onClear: () => void;
  /** Taller row for phone touch targets. */
  large?: boolean;
};

/**
 * Play, multiplayer, and clear buttons for the queue, shared by the queue
 * sidebar and the phone remote so both surfaces stay identical.
 */
export function QueuePlaybackButtons({
  label,
  disabled,
  preparing,
  entries,
  clearing,
  onPlay,
  onPlayMultiplayer,
  onClear,
  large = false,
}: QueuePlaybackButtonsProps) {
  const iconClass = large ? 'size-11' : undefined;

  return (
    <>
      <Button
        size="lg"
        className={large ? 'h-11 flex-1' : 'h-8 flex-1'}
        disabled={disabled}
        aria-busy={preparing}
        onClick={onPlay}
      >
        {preparing ? (
          <>
            <Spinner className="size-4" />
            {t('playbackQueue.queueSidebar.preparingPlayback')}
          </>
        ) : (
          <>
            <PlayIcon />
            {label}
          </>
        )}
      </Button>
      <Button
        variant="outline"
        size="icon-lg"
        className={iconClass}
        disabled={disabled}
        onClick={onPlayMultiplayer}
        aria-label={t('playbackQueue.queueSidebar.playQueueInMultiplayer')}
        title={t('playbackQueue.queueSidebar.playMultiplayer')}
      >
        <UsersIcon />
      </Button>
      <ClearQueueButton
        entries={entries}
        disabled={disabled}
        clearing={clearing}
        blockClass={iconClass ?? ''}
        onClear={onClear}
      />
    </>
  );
}
