import { useCallback } from 'react';

import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import { t } from '@/i18n';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import { cn } from '@/shared/utils/cn';

const RING = 'ring-2 ring-primary';
const NO_FOCUS_RING = 'focus-visible:ring-0 focus-visible:border-transparent';

type PauseOverlayProps = {
  open: boolean;
  exitLabel: string;
  onExit: () => void;
  onContinue: () => void;
};

export const PauseOverlay = ({ open, exitLabel, onExit, onContinue }: PauseOverlayProps) => {
  const onConfirm = useCallback(
    (index: number) => {
      if (index === 0) {
        onContinue();
      } else {
        onExit();
      }
    },
    [onContinue, onExit],
  );

  const { focusedIndex } = useDialogNav({
    open,
    itemCount: 2,
    onConfirm,
    onBack: onContinue,
  });

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/80" aria-hidden />}
      <AlertDialog open={open} onOpenChange={(v) => !v && onContinue()}>
        <AlertDialogContent
          style={{ animation: 'none' }}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t('playback.pauseOverlay.paused')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('playback.pauseOverlay.exitingNowWonAposTDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={onContinue}
              className={cn(NO_FOCUS_RING, open && focusedIndex === 0 && RING)}
            >
              {t('common.actions.continue')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={onExit}
              className={cn(NO_FOCUS_RING, open && focusedIndex === 1 && RING)}
            >
              {exitLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
