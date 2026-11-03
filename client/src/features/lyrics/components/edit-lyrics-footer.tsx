import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { DialogFooter } from '@/shared/components/ui/dialog';
import { cn } from '@/shared/utils/cn';

import { ARIA_DISABLED_CLASS, ringFor } from './parts';

type EditLyricsFooterProps = {
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  canSave: boolean;
  saveLabel: string;
  hint?: string;
  isFocused: (slot: number) => boolean;
};

export const EditLyricsFooter = ({
  onCancel,
  onSave,
  saving,
  canSave,
  saveLabel,
  hint,
  isFocused,
}: EditLyricsFooterProps) => {
  const cancelFocused = isFocused(0);
  const saveFocused = isFocused(1);
  return (
    <DialogFooter className="sm:items-center">
      {typeof hint === 'string' && hint !== '' ? (
        <p className="text-[11px] text-muted-foreground sm:mr-auto sm:text-left">{hint}</p>
      ) : null}
      <Button
        variant="outline"
        onClick={() => {
          if (saving) {
            return;
          }
          onCancel();
        }}
        aria-disabled={saving}
        className={cn(ARIA_DISABLED_CLASS, ringFor(cancelFocused))}
      >
        {t('common.actions.cancel')}
      </Button>
      <Button
        onClick={() => {
          if (!canSave) {
            return;
          }
          onSave();
        }}
        aria-disabled={!canSave}
        className={cn(ARIA_DISABLED_CLASS, ringFor(saveFocused))}
      >
        {saving ? t('lyrics.editor.saving') : saveLabel}
      </Button>
    </DialogFooter>
  );
};
