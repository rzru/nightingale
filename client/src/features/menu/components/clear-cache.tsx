import { useCallback } from 'react';

import { useClearCache } from '@/features/library/hooks/use-clear-cache';
import {
  useDialog,
  type ClearCacheTarget,
  type DialogMode,
} from '@/features/menu/hooks/use-dialog';
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

const clearCacheTarget = (mode: DialogMode): ClearCacheTarget | null => {
  if (typeof mode !== 'object' || mode === null || mode.mode !== 'clear-cache') {
    return null;
  }

  return mode.target;
};

const focusClass = (open: boolean, focusedIndex: number, index: number): string =>
  cn(NO_FOCUS_RING, open && focusedIndex === index && RING);

const COPY: Record<ClearCacheTarget, { title: string; description: string }> = {
  all: {
    title: 'menu.clearCache.clearAllCache',
    description: 'menu.clearCache.thisWillPermanentlyDeleteEveryDescription',
  },
  videos: {
    title: 'menu.clearCache.clearVideosCache',
    description: 'menu.clearCache.thisWillPermanentlyDeleteAllDescription',
  },
  models: {
    title: 'menu.clearCache.clearModelsCache',
    description: 'menu.clearCache.thisWillPermanentlyDeleteTheDescription',
  },
};

export const ClearCacheDialog = () => {
  const { close, mode } = useDialog();
  const clearCache = useClearCache();

  const target = clearCacheTarget(mode);
  const open = target !== null;

  const runClear = useCallback(() => {
    if (!target) {
      return;
    }
    void clearCache[target]();
    close();
  }, [target, clearCache, close]);

  const onConfirm = useCallback(
    (index: number) => {
      if (index === 0) {
        close();
      } else {
        runClear();
      }
    },
    [close, runClear],
  );

  const { focusedIndex } = useDialogNav({
    open,
    itemCount: 2,
    onConfirm,
    onBack: close,
  });

  const copy = target ? COPY[target] : null;

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {copy ? t(copy.title) : t('menu.clearCache.fallbackTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription>{copy ? t(copy.description) : ''}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={close} className={focusClass(open, focusedIndex, 0)}>
            {t('common.actions.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={runClear}
            className={focusClass(open, focusedIndex, 1)}
          >
            {t('menu.clearCache.clearCache')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
