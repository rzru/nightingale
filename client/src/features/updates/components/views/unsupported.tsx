import { ExternalLinkIcon, InfoIcon, ServerIcon } from 'lucide-react';

import type { UnsupportedChannel } from '@/features/updates/queries/use-update';
import { t } from '@/i18n';

import { CURRENT_VERSION, InfoLine, PairFooter, type FocusCtx, type ViewParts } from '../parts';

type Args = {
  ctx: FocusCtx;
  channel: UnsupportedChannel;
  onClose: () => void;
  onOpenReleases: () => void;
  onOpenSelfHostedDocs: () => void;
};

/**
 * Two distinct "manual update" stories share the same dialog layout:
 *
 *  - Tauri Linux build: no bundler-supported auto-update, user downloads
 *    the next release tarball from GitHub.
 *  - Self-hosted web build: nightingale runs as a service on a host the
 *    user controls; updating means SSHing in and re-running the install
 *    script (which already preserves data / config / library).
 *
 * The desktop-Linux copy is byte-identical to the previous version of this
 * view so behaviour for that build doesn't regress.
 */
export const unsupportedView = ({
  ctx,
  channel,
  onClose,
  onOpenReleases,
  onOpenSelfHostedDocs,
}: Args): ViewParts => {
  if (channel === 'self-hosted-web') {
    return selfHostedWebView({ ctx, onClose, onOpenSelfHostedDocs });
  }
  return linuxTauriView({ ctx, onClose, onOpenReleases });
};

type LinuxArgs = {
  ctx: FocusCtx;
  onClose: () => void;
  onOpenReleases: () => void;
};

const linuxTauriView = ({ ctx, onClose, onOpenReleases }: LinuxArgs): ViewParts => ({
  description: 'updates.unsupported.linuxBuildsUseManualUpdatesDescription',
  body: (
    <InfoLine icon={InfoIcon}>
      {t('updates.unsupported.autoUpdateIsnTSupportedDescription', { value1: CURRENT_VERSION })}
    </InfoLine>
  ),
  footer: (
    <PairFooter
      ctx={ctx}
      onClose={onClose}
      primaryLabel="updates.actions.openReleases"
      primaryIcon={ExternalLinkIcon}
      onPrimary={onOpenReleases}
    />
  ),
});

type SelfHostedArgs = {
  ctx: FocusCtx;
  onClose: () => void;
  onOpenSelfHostedDocs: () => void;
};

const selfHostedWebView = ({ ctx, onClose, onOpenSelfHostedDocs }: SelfHostedArgs): ViewParts => ({
  description: 'updates.unsupported.selfHostedInstanceUpdateByDescription',
  body: (
    <div className="flex flex-col gap-3">
      <InfoLine icon={ServerIcon}>
        {t('updates.unsupported.youReUsingASelfDescription', { value1: CURRENT_VERSION })}
      </InfoLine>
      <pre className="rounded-md bg-muted px-3 py-2 text-[0.7rem] font-mono leading-relaxed whitespace-pre-wrap break-all">
        curl -fsSL https://raw.githubusercontent.com/rzru/nightingale/main/scripts/install.sh | bash
      </pre>
    </div>
  ),
  footer: (
    <PairFooter
      ctx={ctx}
      onClose={onClose}
      primaryLabel="updates.actions.openSelfHostedDocs"
      primaryIcon={ExternalLinkIcon}
      onPrimary={onOpenSelfHostedDocs}
    />
  ),
});
