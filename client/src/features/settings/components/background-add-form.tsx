import { type Dispatch, type RefObject, type SetStateAction } from 'react';
import { toast } from 'sonner';

import { pickCustomBackgroundFile, usesNativeBackgroundPicker } from '@/bridge/backgrounds';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { ButtonGroup } from '@/shared/components/ui/button-group';
import { Field, FieldDescription, FieldGroup } from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';

import type { BackgroundDraft } from '../lib/background-draft';

const BACKGROUND_ACCEPT = '.jpg,.jpeg,.png,.webp,.glsl,.frag,.fs,.mp4,.webm';
const SUPPORTED_FORMATS = '.jpg, .jpeg, .png, .webp, .glsl, .frag, .fs, .mp4, .webm';

export function BackgroundAddForm({
  draft,
  setDraft,
  fileInputRef,
  getFocusClassName,
}: {
  draft: BackgroundDraft;
  setDraft: Dispatch<SetStateAction<BackgroundDraft>>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  getFocusClassName: (index: number) => string | undefined;
}) {
  const chooseNativeFile = async () => {
    try {
      const selected = await pickCustomBackgroundFile();
      if (selected !== undefined) {
        setDraft((current) => ({
          ...current,
          nativePath: selected.path,
          nativeFileName: selected.name,
          name: current.name === '' ? selected.name.replace(/\.[^.]+$/, '') : current.name,
        }));
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('settings.backgrounds.chooseFileError'),
      );
    }
  };
  const chooseFile = () => {
    if (usesNativeBackgroundPicker) {
      void chooseNativeFile();
    } else {
      fileInputRef.current?.click();
    }
  };

  return (
    <FieldGroup>
      <Field>
        <Label>{t('settings.backgroundAddForm.source')}</Label>
        <ButtonGroup>
          <Button
            variant={draft.sourceType === 'upload' ? 'default' : 'outline'}
            className={getFocusClassName(0)}
            onClick={() => setDraft((current) => ({ ...current, sourceType: 'upload' }))}
          >
            {t('settings.backgroundAddForm.upload')}
          </Button>
          <Button
            variant={draft.sourceType === 'url' ? 'default' : 'outline'}
            className={getFocusClassName(1)}
            onClick={() => setDraft((current) => ({ ...current, sourceType: 'url' }))}
          >
            {t('settings.backgroundAddForm.link')}
          </Button>
        </ButtonGroup>
        <FieldDescription>
          {t('settings.backgroundAddForm.supportedValue1', { value1: SUPPORTED_FORMATS })}
        </FieldDescription>
      </Field>

      <Field>
        <Label htmlFor="background-name">{t('settings.backgroundAddForm.name')}</Label>
        <Input
          id="settings.backgroundAddForm.backgroundName"
          value={draft.name}
          maxLength={80}
          placeholder={t('settings.backgroundAddForm.myBackground')}
          className={getFocusClassName(2)}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
        />
      </Field>

      {draft.sourceType === 'url' ? (
        <Field>
          <Label htmlFor="background-url">{t('settings.backgroundAddForm.httpsLink')}</Label>
          <Input
            id="settings.backgroundAddForm.backgroundUrl"
            type="url"
            value={draft.url}
            maxLength={2048}
            placeholder="https://example.com/background"
            className={getFocusClassName(3)}
            onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
          />
        </Field>
      ) : (
        <Field>
          <Label>{t('settings.backgroundAddForm.file')}</Label>
          <input
            ref={fileInputRef}
            id="settings.backgroundAddForm.backgroundFile"
            type="file"
            accept={BACKGROUND_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              setDraft((current) => ({
                ...current,
                file,
                name:
                  file !== undefined && current.name === ''
                    ? file.name.replace(/\.[^.]+$/, '')
                    : current.name,
              }));
            }}
          />
          <div className="flex min-w-0 items-center gap-3">
            <Button
              type="button"
              variant="outline"
              className={getFocusClassName(3)}
              onClick={chooseFile}
            >
              {t('settings.backgroundAddForm.chooseFile')}
            </Button>
            <span className="truncate text-sm text-muted-foreground" aria-live="polite">
              {draft.nativeFileName ?? draft.file?.name ?? t('settings.backgrounds.noFileSelected')}
            </span>
          </div>
        </Field>
      )}
    </FieldGroup>
  );
}
