import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import type { SidecarLrcKind } from '@/types/SidecarLrcKind';

type SidecarLrcNoticeProps = {
  fileName: string;
  kind: SidecarLrcKind;
  showing: boolean;
  canUse: boolean;
  onUse: () => void;
};

const extensionLabel = (kind: SidecarLrcKind): string => (kind === 'elrc' ? '.elrc' : '.lrc');

export const SidecarLrcNotice = ({
  fileName,
  kind,
  showing,
  canUse,
  onUse,
}: SidecarLrcNoticeProps) => {
  if (!showing && !canUse) {
    return null;
  }
  const ext = extensionLabel(kind);
  return (
    <output className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
      {showing ? (
        t('lyrics.sidecarLrcNotice.loadedLocalSidecarExtensionFromDisk', { extension: ext })
      ) : (
        <>
          {t('lyrics.sidecarLrcNotice.localExtensionFoundNextToDescription', { extension: ext })}
          <Button
            variant="outline"
            size="xs"
            onClick={onUse}
            title={fileName}
            aria-label={t('lyrics.sidecarLrcNotice.useLocalExtensionFilename', {
              extension: ext,
              fileName,
            })}
          >
            {t('lyrics.sidecarLrcNotice.useLocalExtension', { extension: ext })}
          </Button>
        </>
      )}
    </output>
  );
};
