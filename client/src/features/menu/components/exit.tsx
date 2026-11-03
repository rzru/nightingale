import { useCallback } from 'react';

import { exit } from '@/bridge/exit';
import { useDialog } from '@/features/menu/hooks/use-dialog';
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

export const ExitDialog = () => {
  const { close, mode } = useDialog();

  const open = mode === 'exit';

  const onConfirm = useCallback(
    (index: number) => {
      if (index === 0) {
        close();
      } else {
        void exit();
      }
    },
    [close],
  );

  const { focusedIndex } = useDialogNav({
    open,
    itemCount: 2,
    onConfirm,
    onBack: close,
  });

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('menu.exit.exit')}</AlertDialogTitle>
          <AlertDialogDescription>{t('menu.exit.areYouSureYouWantToQuit')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={close}
            className={cn(NO_FOCUS_RING, open && focusedIndex === 0 && RING)}
          >
            {t('common.actions.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => void exit()}
            className={cn(NO_FOCUS_RING, open && focusedIndex === 1 && RING)}
          >
            {t('menu.exit.exit')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
