import { ANALYSIS_STATUS_STYLES } from '@/features/library/lib/analysis-status-styles';
import { t } from '@/i18n';
import type { QueuedStatus } from '@/types/QueuedStatus';
import type { Song } from '@/types/Song';

export type SongStatusInfo = {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  className?: string;
  isAnalyzing?: boolean;
  isReady?: boolean;
};

export function formatTranscriptSource(source: Song['transcript_source']): string {
  if (source === 'Lyrics') {
    return t('library.songStatus.aiAligned');
  }
  if (source === 'Usdx') {
    return 'USDX';
  }
  if (source === 'Lrc') {
    return 'LRC';
  }
  return t('library.songStatus.aiTranscribed');
}

export function getSongStatusInfo(isAnalyzed: boolean, queueStatus?: QueuedStatus): SongStatusInfo {
  if (queueStatus === 'Queued') {
    return {
      label: t('library.songStatus.queued'),
      variant: 'secondary',
      className: ANALYSIS_STATUS_STYLES.queued,
    };
  }

  if (typeof queueStatus === 'object') {
    if ('Analyzing' in queueStatus) {
      return {
        label: t('library.songStatus.analyzing', { progress: queueStatus.Analyzing }),
        variant: 'default',
        className: `${ANALYSIS_STATUS_STYLES.analysing} animate-pulse`,
        isAnalyzing: true,
      };
    }
    if ('Failed' in queueStatus) {
      return { label: t('library.songStatus.failed'), variant: 'destructive' };
    }
  }

  if (isAnalyzed) {
    return {
      label: t('library.songStatus.ready'),
      variant: 'default',
      className: ANALYSIS_STATUS_STYLES.analysed,
      isReady: true,
    };
  }

  return { label: t('library.songStatus.notAnalyzed'), variant: 'outline' };
}
