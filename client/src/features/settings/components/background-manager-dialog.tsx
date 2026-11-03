import { useRef, useState } from 'react';

import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import type { AppConfig } from '@/types/AppConfig';

import { createBackgroundDraft, canSubmitBackground } from '../lib/background-draft';
import { useBackgroundMutations } from '../mutations/use-background-mutations';
import { BackgroundAddForm } from './background-add-form';
import { BackgroundTable } from './background-table';

function backgroundManagerStops(view: 'list' | 'add', backgroundCount: number): number[] {
  return view === 'list'
    ? [1, ...Array.from({ length: backgroundCount }, () => 1), 1]
    : [2, 1, 1, 2];
}

export function BackgroundManagerDialog({
  open,
  config,
  onOpenChange,
}: {
  open: boolean;
  config: AppConfig | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<'list' | 'add'>('list');
  const [draft, setDraft] = useState(createBackgroundDraft);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const resetAddView = () => {
    setDraft(createBackgroundDraft());
    if (fileInputRef.current !== null) {
      fileInputRef.current.value = '';
    }
    setView('list');
  };
  const { addMutation, removeMutation } = useBackgroundMutations({
    config,
    onAdded: resetAddView,
    onRemoved: () => setPendingRemoval(null),
  });
  const backgrounds = config?.custom_backgrounds ?? [];
  const busy = addMutation.isLoading || removeMutation.isLoading;
  const removeBackground = (id: string) => {
    if (pendingRemoval === id) {
      removeMutation.mutate(id);
    } else {
      setPendingRemoval(id);
    }
  };
  const closeDialog = () => {
    setView('list');
    setPendingRemoval(null);
    onOpenChange(false);
  };
  const stops = backgroundManagerStops(view, backgrounds.length);
  const itemCount = stops.reduce((total, count) => total + count, 0);
  const { focusedIndex } = useDialogNav({
    open,
    itemCount,
    stops,
    onBack: () => (view === 'add' ? setView('list') : closeDialog()),
    containerRef,
  });
  const getFocusClassName = (index: number) =>
    focusedIndex === index ? 'relative z-10 ring-2 ring-primary' : undefined;
  const footerFocusIndex = view === 'list' ? backgrounds.length + 1 : 4;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : closeDialog())}
    >
      <DialogContent
        ref={containerRef}
        showCloseButton={false}
        className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl"
      >
        {view === 'list' ? (
          <>
            <DialogHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <DialogTitle>
                    {t('settings.backgroundManagerDialog.customBackgroundsValue1', {
                      value1: backgrounds.length,
                    })}
                  </DialogTitle>
                  <DialogDescription>
                    {t(
                      'settings.backgroundManagerDialog.imagesNightingaleGlslShadersAndDescription',
                    )}
                  </DialogDescription>
                </div>
                <Button
                  className={getFocusClassName(0)}
                  onClick={() => {
                    setPendingRemoval(null);
                    setView('add');
                  }}
                >
                  {t('settings.backgroundManagerDialog.addBackground')}
                </Button>
              </div>
            </DialogHeader>

            <BackgroundTable
              backgrounds={backgrounds}
              busy={busy}
              pendingRemoval={pendingRemoval}
              getFocusClassName={(index) => getFocusClassName(index + 1)}
              onRemove={removeBackground}
            />

            <DialogFooter>
              <Button
                variant="outline"
                disabled={busy}
                className={getFocusClassName(footerFocusIndex)}
                onClick={closeDialog}
              >
                {t('common.actions.close')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('settings.backgroundManagerDialog.addBackground')}</DialogTitle>
              <DialogDescription>
                {t('settings.backgroundManagerDialog.addAnImageNightingaleGlslDescription')}
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 overflow-y-auto">
              <BackgroundAddForm
                draft={draft}
                setDraft={setDraft}
                fileInputRef={fileInputRef}
                getFocusClassName={getFocusClassName}
              />
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                disabled={busy}
                className={getFocusClassName(footerFocusIndex)}
                onClick={() => setView('list')}
              >
                {t('common.actions.cancel')}
              </Button>
              <Button
                disabled={!canSubmitBackground(draft, busy)}
                className={getFocusClassName(footerFocusIndex + 1)}
                onClick={() => addMutation.mutate(draft)}
              >
                {t(
                  addMutation.isLoading
                    ? 'settings.backgrounds.adding'
                    : 'settings.backgrounds.add',
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
