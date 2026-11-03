import { TriangleAlertIcon } from 'lucide-react';
import { useRef } from 'react';

import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import { useSelectFolderSource } from '@/features/sources/mutations/use-source-mutations';
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
import { useConfig } from '@/shared/config/use-config';
import { cn } from '@/shared/utils/cn';

const warningCopy =
  'Nightingale cannot preserve analysis when the data source changes. All songs in the current library — including analyzed songs and their analysis results — will be dropped from Nightingale. Your source files will not be deleted.';

export const SourceChangeWarning = () => {
  const { data: config } = useConfig();

  if (!config?.library_source) {
    return null;
  }

  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-2 border-y py-2 text-left text-xs/relaxed">
      <TriangleAlertIcon className="mt-0.5 size-3.5 text-destructive" />
      <div>
        <p className="font-bold">{t('sources.sourceChangeWarning.currentLibraryWillBeCleared')}</p>
        <p className="text-muted-foreground">{warningCopy}</p>
      </div>
    </div>
  );
};

export const FolderSourceConfirmDialog = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { mode, close } = useDialog();
  const selectFolder = useSelectFolderSource();
  const open = mode === 'folder-source-confirm';
  const { focusedIndex } = useDialogNav({
    open,
    itemCount: 2,
    onBack: close,
    containerRef,
  });
  const focusClass = (index: number) =>
    cn(
      'focus-visible:ring-0 focus-visible:border-transparent',
      focusedIndex === index && 'ring-2 ring-primary',
    );

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('sources.sourceChangeWarning.changeDataSource')}</AlertDialogTitle>
          <AlertDialogDescription>{warningCopy}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter ref={containerRef}>
          <AlertDialogCancel onClick={close} className={focusClass(0)}>
            {t('common.actions.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              close();
              selectFolder.mutate();
            }}
            className={focusClass(1)}
          >
            {t('sources.sourceChangeWarning.chooseFolder')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
