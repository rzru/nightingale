import {
  AlignLeftIcon,
  AudioLinesIcon,
  ImageIcon,
  MicIcon,
  RefreshCwIcon,
  Trash2Icon,
  XCircleIcon,
  EllipsisIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { useAnalysis } from '@/features/library/hooks/use-analysis';
import { useSongs } from '@/features/library/queries/use-songs';
import { useMenuFocus } from '@/features/menu/providers/menu-focus-context';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { cn } from '@/shared/utils/cn';

type CancelAnalysisItemProps = {
  count: number;
  onClick: () => void;
};

const CancelAnalysisItem = ({ count, onClick }: CancelAnalysisItemProps) => {
  if (count === 0) {
    return null;
  }

  return (
    <DropdownMenuItem variant="destructive" onClick={onClick}>
      <XCircleIcon />
      {t('library.bulkActionsMenu.cancelAnalysisCount', { count })}
    </DropdownMenuItem>
  );
};

export const BulkActionsMenu = () => {
  const {
    enqueueAll,
    cancelAnalysisAll,
    realignAll,
    reanalyzeAllFull,
    reanalyzeAllTranscript,
    reanalyzeAllForceTranscribe,
    refreshMetadataAll,
    deleteSongCacheAll,
  } = useAnalysis();
  const { data } = useSongs();
  const { analyzed_count: analyzedCount = 0, analysis_busy_count: analysisBusyCount = 0 } =
    data?.pages[0] ?? {};

  const [open, setOpen] = useState(false);
  const { focus, actionsRef } = useMenuFocus();

  useEffect(() => {
    const actions = actionsRef.current;
    actions.onConfirmActions = (index) => {
      if (index !== 1) {
        return false;
      }
      setOpen(true);
      return true;
    };

    return () => {
      actions.onConfirmActions = null;
    };
  }, [actionsRef]);

  const isActionsFocused =
    focus.active && focus.panel === 'songList' && focus.actionsFocused && focus.actionsIndex === 1;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          data-actions-index="1"
          aria-label={t('library.bulkActionsMenu.actionsOnFilteredSongs')}
          title={t('common.actions.label')}
          className={cn(
            'border-input bg-input/20 focus-visible:border-transparent focus-visible:ring-0 dark:bg-input/30',
            isActionsFocused && 'ring-2 ring-primary',
          )}
        >
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>{t('library.bulkActionsMenu.allSongs')}</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => void enqueueAll()}>
          <AudioLinesIcon />
          {t('library.bulkActionsMenu.analyzeAll')}
        </DropdownMenuItem>
        <CancelAnalysisItem count={analysisBusyCount} onClick={() => void cancelAnalysisAll()} />
        <DropdownMenuItem onClick={() => void refreshMetadataAll()}>
          <ImageIcon />
          {t('library.bulkActionsMenu.refreshMetadata')}
        </DropdownMenuItem>
        {analyzedCount > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              {t('library.bulkActionsMenu.analyzedSongsValue1', { value1: analyzedCount })}
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => void realignAll()}>
              <AlignLeftIcon />
              {t('library.bulkActionsMenu.realign')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void reanalyzeAllTranscript()}>
              <RefreshCwIcon />
              {t('library.bulkActionsMenu.refetchLyricsAlign')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void reanalyzeAllForceTranscribe()}>
              <MicIcon />
              {t('library.bulkActionsMenu.forceTranscribe')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void reanalyzeAllFull()}>
              <AudioLinesIcon />
              {t('library.bulkActionsMenu.fullReanalysis')}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => void deleteSongCacheAll()}>
              <Trash2Icon />
              {t('library.bulkActionsMenu.deleteCache')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
