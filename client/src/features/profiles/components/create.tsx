import { useRef, useState } from 'react';

import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import { useProfileMutations } from '@/features/profiles/mutations/use-profile-mutations';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Field, FieldGroup } from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { cn } from '@/shared/utils/cn';

export const CreateProfileDialog = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState<string | null>(null);

  const { mode, close } = useDialog();
  const { mutateAsync } = useProfileMutations();

  const open = mode === 'create-profile';

  const { focusedIndex } = useDialogNav({
    open,
    itemCount: 2,
    onBack: close,
    containerRef,
  });

  const createProfile = async (): Promise<void> => {
    if (typeof name !== 'string' || name === '') {
      close();
      return;
    }

    await mutateAsync({ name, type: 'create' });
    close();
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-sm">
        <div className="contents">
          <DialogHeader>
            <DialogTitle>{t('profiles.create.createProfile')}</DialogTitle>
            <DialogDescription>
              {t('profiles.create.justEnterYourProfileNameDescription')}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <Label htmlFor="name-1">{t('profiles.create.name')}</Label>
              <Input
                id="profiles.create.name1"
                name="name"
                onChange={({ target: { value } }) => setName(value)}
                className={cn(
                  'focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-transparent',
                )}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <div
              ref={containerRef}
              className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"
            >
              <DialogClose asChild>
                <Button
                  variant="outline"
                  onClick={close}
                  className={cn(
                    'focus-visible:ring-0 focus-visible:border-transparent',
                    focusedIndex === 0 && 'ring-2 ring-primary',
                  )}
                >
                  {t('common.actions.cancel')}
                </Button>
              </DialogClose>
              <Button
                disabled={typeof name !== 'string' || name === ''}
                type="submit"
                onClick={() => void createProfile()}
                className={cn(
                  'focus-visible:ring-0 focus-visible:border-transparent',
                  focusedIndex === 1 && 'ring-2 ring-primary',
                )}
              >
                {t('profiles.create.create')}
              </Button>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};
