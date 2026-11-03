import { Grid2X2Icon, ListIcon, ListMusicIcon } from 'lucide-react';
import { useRef } from 'react';

import { useLibraryFilter } from '@/features/menu/hooks/use-library-filter';
import { useSearch } from '@/features/menu/hooks/use-search';
import { useMenuFocus } from '@/features/menu/providers/menu-focus-context';
import { t, tp } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { SidebarTrigger } from '@/shared/components/ui/sidebar';
import { cn } from '@/shared/utils/cn';

import { BulkActionsMenu } from './bulk-actions-menu';

const DEBOUNCE_MS = 500;
export type SongListView = 'table' | 'grid';

type LibraryToolbarProps = {
  view: SongListView;
  queueCount: number;
  onOpenQueue: () => void;
  onViewChange: (view: SongListView) => void;
  isSavingView?: boolean;
};

export const LibraryToolbar = ({
  view,
  queueCount,
  onOpenQueue,
  onViewChange,
  isSavingView,
}: LibraryToolbarProps) => {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { search, setSearch } = useSearch();
  const { status, transcript_source, setLibraryFilter } = useLibraryFilter();
  const { focus } = useMenuFocus();
  const isActionFocused = (index: number) =>
    focus.active &&
    focus.panel === 'songList' &&
    focus.actionsFocused &&
    focus.actionsIndex === index;

  const handleChange = (value: string) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSearch(value), DEBOUNCE_MS);
  };

  return (
    <div className="grid w-full grid-cols-2 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] 2xl:grid-cols-[minmax(12rem,1fr)_auto_auto_auto]">
      <div className="col-span-2 flex min-w-0 items-center gap-2 sm:col-span-3 2xl:col-span-1">
        <SidebarTrigger variant="outline" size="icon" className="shrink-0 md:hidden" />
        <Input
          defaultValue={search}
          onChange={({ target: { value } }) => handleChange(value)}
          className="min-w-0 flex-1"
          placeholder={t('library.libraryToolbar.searchSongs')}
          aria-label={t('library.libraryToolbar.searchSongs')}
        />
      </div>
      <Select
        value={status ?? 'all'}
        onValueChange={(value) =>
          setLibraryFilter((current) => ({
            ...current,
            status: value === 'all' ? null : value,
          }))
        }
      >
        <SelectTrigger
          aria-label={t('library.libraryToolbar.filterByAnalysisStatus')}
          className="w-full min-w-0 2xl:w-32"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>{t('library.libraryToolbar.status')}</SelectLabel>
            <SelectItem value="all">{t('library.libraryToolbar.allStatuses')}</SelectItem>
            <SelectItem value="not_analyzed">{t('library.libraryToolbar.notAnalyzed')}</SelectItem>
            <SelectItem value="queued">{t('library.libraryToolbar.queued')}</SelectItem>
            <SelectItem value="analyzing">{t('library.libraryToolbar.analyzing')}</SelectItem>
            <SelectItem value="analyzed">{t('library.libraryToolbar.analyzed')}</SelectItem>
            <SelectItem value="failed">{t('library.libraryToolbar.failed')}</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select
        value={transcript_source ?? 'all'}
        onValueChange={(value) =>
          setLibraryFilter((current) => ({
            ...current,
            transcript_source: value === 'all' ? null : value,
          }))
        }
      >
        <SelectTrigger
          aria-label={t('library.libraryToolbar.filterByTranscriptType')}
          className="w-full min-w-0 2xl:w-32"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>{t('library.libraryToolbar.type')}</SelectLabel>
            <SelectItem value="all">{t('library.libraryToolbar.allTypes')}</SelectItem>
            <SelectItem value="generated">{t('library.libraryToolbar.generated')}</SelectItem>
            <SelectItem value="lyrics">{t('library.libraryToolbar.aiAligned')}</SelectItem>
            <SelectItem value="lrc">LRC</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <div className="col-span-2 flex items-center justify-end gap-2 sm:col-span-1">
        <Button
          variant="outline"
          size="icon"
          className={cn('relative', isActionFocused(0) && 'ring-2 ring-primary')}
          data-actions-index="0"
          onClick={onOpenQueue}
          aria-label={tp('library.toolbar.openQueue', queueCount)}
          title={t('library.libraryToolbar.playbackQueue')}
        >
          <ListMusicIcon />
          {queueCount > 0 ? (
            <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
              {queueCount}
            </span>
          ) : null}
        </Button>
        <BulkActionsMenu />
        <fieldset
          className="flex shrink-0 rounded-md border bg-input/20 p-0.5"
          aria-label={t('library.libraryToolbar.songListView')}
        >
          <Button
            variant={view === 'table' ? 'secondary' : 'ghost'}
            size="icon-sm"
            className={cn(isActionFocused(2) && 'ring-2 ring-primary')}
            data-actions-index="2"
            disabled={isSavingView}
            onClick={() => onViewChange('table')}
            aria-label={t('library.libraryToolbar.tableView')}
            aria-pressed={view === 'table'}
            title={t('library.libraryToolbar.tableView')}
          >
            <ListIcon />
          </Button>
          <Button
            variant={view === 'grid' ? 'secondary' : 'ghost'}
            size="icon-sm"
            className={cn(isActionFocused(3) && 'ring-2 ring-primary')}
            data-actions-index="3"
            disabled={isSavingView}
            onClick={() => onViewChange('grid')}
            aria-label={t('library.libraryToolbar.cardGridView')}
            aria-pressed={view === 'grid'}
            title={t('library.libraryToolbar.cardGridView')}
          >
            <Grid2X2Icon />
          </Button>
        </fieldset>
      </div>
    </div>
  );
};
