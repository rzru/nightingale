import { useCacheStats } from '@/features/library/queries/use-cache-stats';
import { formatBytes, segmentPercent, totalUsedBytes } from '@/features/library/utils/stats';
import { t } from '@/i18n';
import { SegmentedProgress } from '@/shared/components/ui/segmented-progress';

import { CacheActions } from './cache-actions';

const rows = [
  { label: 'menu.sidebar.stats.songs', color: 'bg-blue-500', key: 'songs_bytes' as const },
  { label: 'menu.sidebar.stats.videos', color: 'bg-green-500', key: 'videos_bytes' as const },
  { label: 'menu.sidebar.stats.models', color: 'bg-yellow-500', key: 'models_bytes' as const },
  { label: 'menu.sidebar.stats.other', color: 'bg-gray-500', key: 'other_bytes' as const },
];

type StatsProps = {
  cacheFocusedSidebarIndex: number;
  registerCacheCallback: (callback: ((subIndex: number) => void) | null) => void;
};

export const Stats = ({ cacheFocusedSidebarIndex, registerCacheCallback }: StatsProps) => {
  const { data: stats, isLoading, isError } = useCacheStats();

  const total = stats ? totalUsedBytes(stats) : 0n;

  const noStatsLabel = isError ? t('menu.sidebar.stats.unavailable') : '…';

  const label = !stats ? noStatsLabel : t('menu.sidebar.stats.used', { size: formatBytes(total) });

  const renderHeader = () => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <CacheActions
        focusedSidebarIndex={cacheFocusedSidebarIndex}
        registerCallback={registerCacheCallback}
      />
    </div>
  );

  if (isLoading || !stats) {
    return (
      <div className="flex flex-col gap-2 px-2">
        {renderHeader()}
        {!isError && <div className="h-2 w-full rounded-full bg-muted" />}
      </div>
    );
  }

  const segments = rows.map((row) => ({
    value: segmentPercent(stats[row.key], total),
    color: row.color,
  }));

  return (
    <div className="flex flex-col gap-2 px-2">
      {renderHeader()}
      <SegmentedProgress segments={segments} />
      <div className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-0 py-0.5 text-xs">
            <div className="flex items-center gap-2">
              <div className={`size-2 shrink-0 rounded-full ${row.color}`} />
              <span className="flex-1">{t(row.label)}</span>
              <span className="text-muted-foreground">{formatBytes(stats[row.key])}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
