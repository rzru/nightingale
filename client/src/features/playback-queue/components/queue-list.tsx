import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVerticalIcon, Trash2Icon } from 'lucide-react';

import type { PlaybackQueueEntry } from '@/bridge/playback-queue';
import { AlbumArt } from '@/features/library/components/song/album-art';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/utils/cn';

type QueueListProps = {
  entries: PlaybackQueueEntry[];
  disabled: boolean;
  onMove: (input: { id: string; targetIndex: number }) => void;
  onRemove: (id: string) => void;
};

type QueueItemProps = {
  entry: PlaybackQueueEntry;
  index: number;
  disabled: boolean;
  onRemove: (id: string) => void;
};

function QueueItem({ entry, index, disabled, onRemove }: QueueItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.id,
    disabled,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 bg-background py-2 first:pt-0 last:pb-0',
        isDragging && 'relative z-10 opacity-60',
      )}
    >
      <button
        type="button"
        disabled={disabled}
        className="-ml-1 grid size-6 shrink-0 touch-none cursor-grab place-items-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={t('playbackQueue.reorderLabel', { title: entry.song.title })}
        title={t('playbackQueue.queueList.dragToReorder')}
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon className="size-4" />
      </button>
      <AlbumArt song={entry.song} className="size-10 rounded-sm" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center text-sm font-medium">
          <p className="truncate">{entry.song.title}</p>
          {index === 0 ? (
            <span className="shrink-0 text-xs font-medium text-primary">
              {t('playbackQueue.queueList.nextUp')}
            </span>
          ) : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">{entry.song.artist || '—'}</p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        onClick={() => onRemove(entry.id)}
        aria-label={t('playbackQueue.removeLabel', { title: entry.song.title })}
      >
        <Trash2Icon />
      </Button>
    </li>
  );
}

export function QueueList({ entries, disabled, onMove, onRemove }: QueueListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const finishDrag = ({ active, over }: DragEndEvent) => {
    if (over === null || active.id === over.id) {
      return;
    }
    const targetIndex = entries.findIndex((entry) => entry.id === over.id);
    if (targetIndex >= 0) {
      onMove({ id: String(active.id), targetIndex });
    }
  };

  if (entries.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t('playbackQueue.queueList.queueIsEmpty')}
      </p>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={finishDrag}>
      <SortableContext
        items={entries.map((entry) => entry.id)}
        strategy={verticalListSortingStrategy}
      >
        <ol className="divide-y">
          {entries.map((entry, index) => (
            <QueueItem
              key={entry.id}
              entry={entry}
              index={index}
              disabled={disabled}
              onRemove={onRemove}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
