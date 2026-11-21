import { ANALYSIS_STATUS_STYLES } from '@/features/library/lib/analysis-status-styles';
import { t, type TranslationKey } from '@/i18n';
import { Badge } from '@/shared/components/ui/badge';
import { cn } from '@/shared/utils/cn';
import type { WishStatus } from '@/types/WishStatus';

const STATUS: Record<WishStatus, { label: TranslationKey; className: string }> = {
  missing: { label: 'playlists.status.missing', className: 'bg-muted text-muted-foreground' },
  available: { label: 'playlists.status.available', className: ANALYSIS_STATUS_STYLES.queued },
  downloading: {
    label: 'playlists.status.downloading',
    className: ANALYSIS_STATUS_STYLES.analysing,
  },
  analyzing: { label: 'playlists.status.analyzing', className: ANALYSIS_STATUS_STYLES.analysing },
  ready: { label: 'playlists.status.ready', className: ANALYSIS_STATUS_STYLES.analysed },
  failed: { label: 'playlists.status.failed', className: 'bg-destructive/15 text-destructive' },
};

export const WishStatusBadge = ({ status }: { status: WishStatus }) => (
  <Badge className={cn('border-transparent', STATUS[status].className)}>
    {t(STATUS[status].label)}
  </Badge>
);
