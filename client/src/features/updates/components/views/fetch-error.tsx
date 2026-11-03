import { WifiOffIcon } from 'lucide-react';

import { t } from '@/i18n';

import { GENERIC_DESCRIPTION, PairFooter, type FocusCtx, type ViewParts } from '../parts';

type Args = {
  ctx: FocusCtx;
  error: Error;
  isOffline: boolean;
  onClose: () => void;
  onRetry: () => void;
};

export const fetchErrorView = ({ ctx, error, isOffline, onClose, onRetry }: Args): ViewParts => {
  const headline = t(
    isOffline
      ? 'updates.fetchError.couldnTReachServer'
      : 'updates.fetchError.couldnTCheckForUpdates',
  );
  const hint = isOffline ? t('updates.fetchError.checkInternetConnection') : error.message;

  return {
    description: GENERIC_DESCRIPTION,
    body: (
      <div className="flex items-start gap-2 text-xs">
        {isOffline && <WifiOffIcon className="size-4 text-destructive shrink-0 mt-0.5" />}
        <div className="flex flex-col gap-1">
          <p className="text-destructive">{headline}</p>
          <p className="text-muted-foreground break-words">{hint}</p>
        </div>
      </div>
    ),
    footer: (
      <PairFooter
        ctx={ctx}
        onClose={onClose}
        primaryLabel="common.actions.retry"
        onPrimary={onRetry}
      />
    ),
  };
};
