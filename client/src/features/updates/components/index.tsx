import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { openUrl } from '@/bridge/opener';
import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import { useInstallFlow, type InstallFlow } from '@/features/updates/hooks';
import { useUpdate, type UpdateState } from '@/features/updates/queries/use-update';
import { t } from '@/i18n';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

import { RELEASES_URL, SELF_HOSTED_DOCS_URL, type FocusCtx, type ViewParts } from './parts';
import { availableView } from './views/available';
import { checkingView } from './views/checking';
import { downloadingView } from './views/downloading';
import { fetchErrorView } from './views/fetch-error';
import { installErrorView } from './views/install-error';
import { installedView } from './views/installed';
import { installingView } from './views/installing';
import { unsupportedView } from './views/unsupported';
import { upToDateView } from './views/up-to-date';

const NOOP = () => {};

type Actions = {
  close: () => void;
  refetch: () => void;
  openReleases: () => void;
  openSelfHostedDocs: () => void;
};

const versionLabel = (state: UpdateState, fallback: string): string =>
  state.status === 'available' ? state.update.version : fallback;

const focusableCount = (state: UpdateState, install: InstallFlow): number => {
  switch (install.state.stage) {
    case 'downloading':
    case 'installing':
      return 0;
    case 'finished':
      return 1;
    case 'error':
      return 2;
    case 'idle':
      break;
  }
  return state.status === 'checking' ? 1 : 2;
};

const isLocked = (install: InstallFlow): boolean =>
  install.state.stage === 'downloading' || install.state.stage === 'installing';

const pickInstallView = (
  state: UpdateState,
  install: InstallFlow,
  ctx: FocusCtx,
  actions: Actions,
): ViewParts | null => {
  switch (install.state.stage) {
    case 'downloading':
      return downloadingView({
        downloaded: install.state.downloaded,
        contentLength: install.state.contentLength,
        version: versionLabel(state, 'update'),
      });
    case 'installing':
      return installingView();
    case 'finished':
      return installedView({
        ctx,
        version: versionLabel(state, 'the new build'),
        onRestart: () => void install.restart(),
      });
    case 'error':
      return installErrorView({
        ctx,
        message: install.state.message,
        onClose: actions.close,
        onRetry: () => void install.install(),
      });
    case 'idle':
      return null;
  }

  install.state satisfies never;
  return null;
};

const pickView = (
  state: UpdateState,
  install: InstallFlow,
  ctx: FocusCtx,
  actions: Actions,
): ViewParts => {
  const installView = pickInstallView(state, install, ctx, actions);
  if (installView !== null) {
    return installView;
  }

  switch (state.status) {
    case 'unsupported':
      return unsupportedView({
        ctx,
        channel: state.channel,
        onClose: actions.close,
        onOpenReleases: actions.openReleases,
        onOpenSelfHostedDocs: actions.openSelfHostedDocs,
      });
    case 'checking':
      return checkingView({ ctx, onClose: actions.close });
    case 'error':
      return fetchErrorView({
        ctx,
        error: state.error,
        isOffline: state.isOffline,
        onClose: actions.close,
        onRetry: actions.refetch,
      });
    case 'up-to-date':
      return upToDateView({ ctx, onClose: actions.close, onRefetch: actions.refetch });
    case 'available':
      return availableView({
        ctx,
        update: state.update,
        onClose: actions.close,
        onInstall: () => void install.install(),
      });
  }
  state satisfies never;
  return checkingView({ ctx, onClose: actions.close });
};

export const UpdateDialog = () => {
  const { mode, close } = useDialog();
  const open = mode === 'update';

  const updateState = useUpdate();
  const { refetch: refetchUpdate } = updateState;
  const installFlow = useInstallFlow(
    updateState.status === 'available' ? updateState.update : null,
  );
  const { reset: resetInstallFlow } = installFlow;

  const locked = isLocked(installFlow);
  const containerRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;

    if (!justOpened) {
      return;
    }

    if (updateState.status === 'unsupported') {
      return;
    }

    if (installFlow.state.stage !== 'idle') {
      return;
    }
    void refetchUpdate();
  }, [installFlow.state.stage, open, refetchUpdate, updateState.status]);

  useEffect(() => {
    if (!open) {
      resetInstallFlow();
    }
  }, [open, resetInstallFlow]);

  const openReleases = useCallback(() => {
    void openUrl(RELEASES_URL).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : t('common.errors.unknown');
      toast.error(t('updates.index.couldnTOpenReleasesPage', { value1: message }));
    });
  }, []);

  const openSelfHostedDocs = useCallback(() => {
    void openUrl(SELF_HOSTED_DOCS_URL).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : t('common.errors.unknown');
      toast.error(t('updates.index.couldnTOpenDocs', { value1: message }));
    });
  }, []);

  const refetch = useCallback(() => {
    void refetchUpdate();
  }, [refetchUpdate]);

  const { focusedIndex } = useDialogNav({
    open,
    itemCount: focusableCount(updateState, installFlow),
    onBack: locked ? NOOP : close,
    containerRef,
  });

  const view = pickView(
    updateState,
    installFlow,
    { open, focusedIndex },
    { close, refetch, openReleases, openSelfHostedDocs },
  );

  const blockClose = (e: { preventDefault: () => void }) => {
    if (locked) {
      e.preventDefault();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next || locked ? undefined : close())}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!locked}
        onEscapeKeyDown={blockClose}
        onInteractOutside={blockClose}
      >
        <div ref={containerRef} className="contents">
          <DialogHeader>
            <DialogTitle>{t('updates.main.update')}</DialogTitle>
            <DialogDescription>{t(view.description)}</DialogDescription>
          </DialogHeader>
          {view.body}
          {view.footer}
        </div>
      </DialogContent>
    </Dialog>
  );
};
