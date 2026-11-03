import type { Update } from '@tauri-apps/plugin-updater';
import { DownloadIcon } from 'lucide-react';

import { formatDate, t } from '@/i18n';
import { Separator } from '@/shared/components/ui/separator';

import { CURRENT_VERSION, PairFooter, type FocusCtx, type ViewParts } from '../parts';
import { ReleaseNotes } from '../release-notes';

type Args = {
  ctx: FocusCtx;
  update: Update;
  onClose: () => void;
  onInstall: () => void;
};

const formatPubDate = (date: string | undefined): string | null => {
  if (typeof date !== 'string' || date === '') {
    return null;
  }

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return formatDate(parsed, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

export const availableView = ({ ctx, update, onClose, onInstall }: Args): ViewParts => {
  const pubDate = formatPubDate(update.date);
  const notes = update.body?.trim();

  return {
    description: 'updates.available.description',
    body: (
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <DownloadIcon className="size-4 text-primary shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <p className="text-xs font-medium">
              {t('updates.available.versionAvailable', { version: update.version })}
            </p>
            <p className="text-[0.7rem] text-muted-foreground">
              {pubDate !== null
                ? t('updates.available.currentVersionWithDate', {
                    version: CURRENT_VERSION,
                    date: pubDate,
                  })
                : t('updates.available.currentVersion', { version: CURRENT_VERSION })}
            </p>
          </div>
        </div>
        {typeof notes === 'string' && notes !== '' && (
          <>
            <Separator />
            <div className="flex flex-col gap-1">
              <h4 className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
                {t('updates.available.releaseNotes')}
              </h4>
              <ReleaseNotes body={notes} />
            </div>
          </>
        )}
      </div>
    ),
    footer: (
      <PairFooter
        ctx={ctx}
        closeLabel="updates.actions.later"
        onClose={onClose}
        primaryLabel="updates.actions.installRestart"
        onPrimary={onInstall}
      />
    ),
  };
};
