import { useRef, useState } from 'react';

import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import { useCurrentProfile } from '@/features/profiles/hooks/use-current-profile';
import { useProfileMutations } from '@/features/profiles/mutations/use-profile-mutations';
import { useProfiles } from '@/features/profiles/queries/use-profiles';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Field, FieldGroup } from '@/shared/components/ui/field';
import { Label } from '@/shared/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { cn } from '@/shared/utils/cn';

export const SelectProfileDialog = () => {
  const { data } = useProfiles();
  const currentProfile = useCurrentProfile();
  const { mode, close, setMode } = useDialog();
  const open = mode === 'select-profile';
  const { mutateAsync } = useProfileMutations();

  const [newProfile, setNewProfile] = useState(currentProfile);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);

  const profiles = data?.profiles ?? [];

  const containerRef = useRef<HTMLDivElement>(null);
  const { focusedIndex } = useDialogNav({
    open,
    itemCount: 5,
    onBack: close,
    containerRef,
  });

  const deleteProfile = async (): Promise<void> => {
    if (typeof newProfile !== 'string' || newProfile === '') {
      setDeleteConfirmationOpen(false);
      return;
    }

    await mutateAsync({ name: newProfile, type: 'delete' });
    setDeleteConfirmationOpen(false);
    close();
  };

  const switchProfile = async (): Promise<void> => {
    if (typeof newProfile !== 'string' || newProfile === '') {
      close();
      return;
    }

    await mutateAsync({ name: newProfile, type: 'switch' });
    close();
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-sm">
        <div ref={containerRef} className="contents">
          <DialogHeader>
            <DialogTitle>{t('profiles.select.selectProfile')}</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <Label htmlFor="model-1">{t('profiles.select.profile')}</Label>
              <Select
                onValueChange={(profile) => setNewProfile(profile)}
                defaultValue={currentProfile}
              >
                <SelectTrigger
                  id="profiles.select.model1"
                  className={cn(
                    'focus-visible:ring-0 focus-visible:border-transparent',
                    focusedIndex === 0 && 'ring-2 ring-primary',
                  )}
                >
                  <SelectValue placeholder={t('profiles.select.selectAProfile')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{t('profiles.select.profile')}</SelectLabel>
                    {profiles.map((profile) => (
                      <SelectItem key={profile} value={profile}>
                        {profile}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button
                variant="outline"
                onClick={close}
                className={cn(
                  'focus-visible:ring-0 focus-visible:border-transparent',
                  focusedIndex === 1 && 'ring-2 ring-primary',
                )}
              >
                {t('common.actions.cancel')}
              </Button>
            </DialogClose>
            <Button
              variant="outline"
              onClick={() => setMode('create-profile')}
              className={cn(
                'focus-visible:ring-0 focus-visible:border-transparent',
                focusedIndex === 2 && 'ring-2 ring-primary',
              )}
            >
              {t('profiles.select.createNew')}
            </Button>
            <Popover open={deleteConfirmationOpen} onOpenChange={setDeleteConfirmationOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="destructive"
                  onClick={() => setDeleteConfirmationOpen(!deleteConfirmationOpen)}
                  className={cn(
                    'focus-visible:ring-0 focus-visible:border-transparent',
                    focusedIndex === 3 && 'ring-2 ring-primary',
                  )}
                >
                  {t('common.actions.delete')}
                </Button>
              </PopoverTrigger>

              <PopoverContent side="bottom" align="start" className="w-48">
                <p className="text-sm">{t('profiles.select.areYouSure')}</p>

                <div className="flex gap-2 justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDeleteConfirmationOpen(false)}
                  >
                    {t('profiles.select.no')}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => void deleteProfile()}>
                    {t('profiles.select.yes')}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <Button
              disabled={newProfile === currentProfile}
              onClick={() => void switchProfile()}
              className={cn(
                'focus-visible:ring-0 focus-visible:border-transparent',
                focusedIndex === 4 && 'ring-2 ring-primary',
              )}
            >
              {t('profiles.select.select')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};
