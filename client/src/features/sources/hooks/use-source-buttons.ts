import { Disc3Icon, FolderIcon, RefreshCwIcon } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

import type { BadgeTone } from '@/features/menu/components/sidebar/source-action-button';
import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useLibrarySourceActions } from '@/features/sources/hooks/use-library-source-actions';
import { t, useTranslation } from '@/i18n';
import { JellyfinIcon } from '@/shared/components/icons/jellyfin';
import { PlexIcon } from '@/shared/components/icons/plex';

export type SourceButton = {
  key: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  tooltip: string;
  handler: () => void;
  disabled: boolean;
  badge?: BadgeTone;
};

type RemoteBadgeInput = {
  label: string;
  baseUrl: string | undefined;
  health: { reachable: boolean; server_name?: string; error?: string } | undefined;
};

const remoteBadge = ({
  label,
  baseUrl,
  health,
}: RemoteBadgeInput): { tooltip: string; badge?: BadgeTone } => {
  if (typeof baseUrl !== 'string' || baseUrl === '') {
    return { tooltip: t('sources.buttons.connectSource', { source: label }) };
  }
  const hostname = health?.server_name ?? baseUrl.replace(/^https?:\/\//, '');
  if (!health) {
    return { tooltip: t('sources.buttons.checkingHost', { host: hostname }), badge: 'muted' };
  }
  if (health.reachable) {
    return { tooltip: t('sources.buttons.connectedToHost', { host: hostname }), badge: 'ok' };
  }
  return {
    tooltip:
      typeof health.error === 'string' && health.error !== ''
        ? t('sources.buttons.offlineWithError', { host: hostname, error: health.error })
        : t('sources.buttons.offline', { host: hostname }),
    badge: 'warn',
  };
};

export const useSourceButtons = (): SourceButton[] => {
  const { setMode } = useDialog();
  useTranslation();
  const {
    selectFolder,
    rescan,
    rescanDisabled,
    isPending,
    hasSource,
    libraryPinned,
    jellyfinSource,
    navidromeSource,
    plexSource,
    jellyfinHealth,
    navidromeHealth,
    plexHealth,
  } = useLibrarySourceActions();

  const jellyfin = remoteBadge({
    label: 'Jellyfin',
    baseUrl: jellyfinSource?.base_url,
    health: jellyfinHealth,
  });
  const navidrome = remoteBadge({
    label: 'Navidrome',
    baseUrl: navidromeSource?.base_url,
    health: navidromeHealth,
  });
  const plex = remoteBadge({
    label: 'Plex',
    baseUrl: plexSource?.base_url,
    health: plexHealth,
  });

  const buttons: SourceButton[] = libraryPinned
    ? []
    : [
        {
          key: 'plex',
          icon: PlexIcon,
          label: t('sources.buttons.connectPlex'),
          tooltip: plex.tooltip,
          handler: () => setMode('plex-connect'),
          disabled: isPending,
          badge: plex.badge,
        },
        {
          key: 'navidrome',
          icon: Disc3Icon,
          label: t('sources.buttons.connectNavidrome'),
          tooltip: navidrome.tooltip,
          handler: () => setMode('navidrome-connect'),
          disabled: isPending,
          badge: navidrome.badge,
        },
        {
          key: 'jellyfin',
          icon: JellyfinIcon,
          label: t('sources.buttons.connectJellyfin'),
          tooltip: jellyfin.tooltip,
          handler: () => setMode('jellyfin-connect'),
          disabled: isPending,
          badge: jellyfin.badge,
        },
        {
          key: 'folder',
          icon: FolderIcon,
          label: t('sources.buttons.selectFolder'),
          tooltip: t('sources.buttons.selectFolder'),
          handler: hasSource ? () => setMode('folder-source-confirm') : selectFolder,
          disabled: isPending,
        },
      ];

  if (hasSource) {
    buttons.push({
      key: 'rescan',
      icon: RefreshCwIcon,
      label: t('sources.buttons.rescanLibrary'),
      tooltip: t('sources.buttons.rescanLibraryHint'),
      handler: rescan,
      disabled: rescanDisabled,
    });
  }

  return buttons;
};
