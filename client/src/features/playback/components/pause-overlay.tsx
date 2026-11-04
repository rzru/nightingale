import type { PlaybackCommand } from '@/bridge/playback-status';
import { PlaybackActionButtons } from '@/features/playback/components/playback-action-buttons';
import type { PlaybackAction } from '@/features/playback/lib/playback-actions';
import { t } from '@/i18n';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';

type PauseOverlayProps = {
  open: boolean;
  actions: PlaybackAction[];
  onCommand: (command: PlaybackCommand) => void;
};

export const PauseOverlay = ({ open, actions, onCommand }: PauseOverlayProps) => {
  const onContinue = () => onCommand('resume');

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/80" aria-hidden />}
      <AlertDialog open={open} onOpenChange={(value) => !value && onContinue()}>
        <AlertDialogContent
          style={{ animation: 'none' }}
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t('playback.pauseOverlay.paused')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('playback.pauseOverlay.exitingNowWonAposTDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <PlaybackActionButtons
              actions={actions}
              onCommand={onCommand}
              open={open}
              onBack={onContinue}
              className="w-full justify-end"
            />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
