import {
  AlignLeftIcon,
  AudioLinesIcon,
  GaugeIcon,
  ImageIcon,
  MicIcon,
  PackageIcon,
  RefreshCwIcon,
  Trash2Icon,
  XCircleIcon,
  EllipsisIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { exportLibraryNge, onLibraryExportDone } from '@/bridge/playback';
import { selectFolderPath } from '@/bridge/source';
import { useAnalysis } from '@/features/library/hooks/use-analysis';
import { useSongs } from '@/features/library/queries/use-songs';
import { useMenuFocus } from '@/features/menu/providers/menu-focus-context';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { useConfig } from '@/shared/config/use-config';
import { useConfigMutation } from '@/shared/config/use-config-mutation';
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
      Cancel analysis ({count})
    </DropdownMenuItem>
  );
};

// The `.nge` export audio codec, persisted in config and applied to every
// export. Kept as its own component so its config read/write stays out of
// `BulkActionsMenu`'s complexity budget.
const ExportQualitySubmenu = () => {
  const { data: config } = useConfig();
  const { mutate } = useConfigMutation();
  const value = config?.export_audio_codec ?? 'none';

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <GaugeIcon />
        Export quality
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(export_audio_codec) => mutate({ export_audio_codec })}
        >
          <DropdownMenuRadioItem value="none">Lossless (keep stems)</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="opus128">Opus 128 kbps</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="opus96">Opus 96 kbps</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
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

  useEffect(() => {
    const state: { unlisten?: () => void; cancelled: boolean } = { cancelled: false };
    void (async () => {
      const unlisten = await onLibraryExportDone((event) => {
        if (event.ok) {
          toast.success(
            `Exported ${event.exported} song(s) to .nge — skipped ${event.skipped}, failed ${event.failed}.`,
          );
        } else {
          toast.error(`Library export failed: ${event.error ?? 'unknown error'}`);
        }
      });
      if (state.cancelled) {
        unlisten();
      } else {
        state.unlisten = unlisten;
      }
    })();
    return () => {
      state.cancelled = true;
      state.unlisten?.();
    };
  }, []);

  const handleExportLibrary = async () => {
    const destDir = await selectFolderPath();
    if (destDir === undefined) {
      return;
    }
    setOpen(false);
    toast.info('Exporting library to .nge… you’ll be notified when it finishes.');
    exportLibraryNge(destDir);
  };

  const isActionsFocused =
    focus.active && focus.panel === 'songList' && focus.actionsFocused && focus.actionsIndex === 1;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          data-actions-index="1"
          aria-label="Actions on filtered songs"
          title="Actions"
          className={cn(
            'border-input bg-input/20 focus-visible:border-transparent focus-visible:ring-0 dark:bg-input/30',
            isActionsFocused && 'ring-2 ring-primary',
          )}
        >
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>All songs</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => void enqueueAll()}>
          <AudioLinesIcon />
          Analyze all
        </DropdownMenuItem>
        <CancelAnalysisItem count={analysisBusyCount} onClick={() => void cancelAnalysisAll()} />
        <DropdownMenuItem onClick={() => void refreshMetadataAll()}>
          <ImageIcon />
          Refresh metadata
        </DropdownMenuItem>
        {analyzedCount > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Analyzed songs ({analyzedCount})</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => void realignAll()}>
              <AlignLeftIcon />
              Realign
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void reanalyzeAllTranscript()}>
              <RefreshCwIcon />
              Refetch lyrics & align
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void reanalyzeAllForceTranscribe()}>
              <MicIcon />
              Force transcribe
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void reanalyzeAllFull()}>
              <AudioLinesIcon />
              Full reanalysis
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => void deleteSongCacheAll()}>
              <Trash2Icon />
              Delete cache
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Export</DropdownMenuLabel>
        <ExportQualitySubmenu />
        <DropdownMenuItem onClick={() => void handleExportLibrary()}>
          <PackageIcon />
          Export library to .nge…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
