import { memo, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

import {
  lineBounds,
  MIN_WORD_SEC,
  type EditorLine,
  type WordRef,
} from '@/features/timing-editor/lib/model';
import { PX_PER_SEC, STRIP_MARGIN_SEC } from '@/features/timing-editor/lib/strip-geometry';
import { drawPeaks, type Peaks } from '@/features/timing-editor/lib/waveform';
import { t, useTranslation } from '@/i18n';
import { cn } from '@/shared/utils/cn';

const WAVE_COLOR = 'rgba(148,163,184,0.55)';

type DragKind = 'move' | 'start' | 'end';

export type WordTimesChange = {
  ref: WordRef;
  start: number;
  end: number;
  /** False while dragging, true on release. */
  final: boolean;
};

type Props = {
  line: EditorLine;
  lineIndex: number;
  selectedWord: number | null;
  peaks: Peaks | null;
  /** Playhead time, or `null` when it is outside this line's strip. */
  playhead: number | null;
  onSelect: (ref: WordRef) => void;
  onSeek: (time: number) => void;
  onTimesChange: (change: WordTimesChange) => void;
};

type DragState = {
  kind: DragKind;
  word: number;
  startX: number;
  start: number;
  end: number;
};

function draggedTimes(drag: DragState, deltaSec: number): { start: number; end: number } {
  if (drag.kind === 'move') {
    const start = Math.max(0, drag.start + deltaSec);
    return { start, end: start + (drag.end - drag.start) };
  }
  if (drag.kind === 'start') {
    return {
      start: Math.min(Math.max(0, drag.start + deltaSec), drag.end - MIN_WORD_SEC),
      end: drag.end,
    };
  }
  return { start: drag.start, end: Math.max(drag.start + MIN_WORD_SEC, drag.end + deltaSec) };
}

function LineStripImpl({
  line,
  lineIndex,
  selectedWord,
  peaks,
  playhead,
  onSelect,
  onSeek,
  onTimesChange,
}: Props) {
  useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const bounds = lineBounds(line);
  const from = Math.max(0, bounds.start - STRIP_MARGIN_SEC);
  const width = Math.max(120, (bounds.end + STRIP_MARGIN_SEC - from) * PX_PER_SEC);
  const toX = (time: number) => (time - from) * PX_PER_SEC;

  useEffect(() => {
    // `width` is read so the wave is redrawn when the strip changes size.
    if (canvasRef.current && peaks && width > 0) {
      drawPeaks({
        canvas: canvasRef.current,
        peaks,
        from,
        pxPerSec: PX_PER_SEC,
        color: WAVE_COLOR,
      });
    }
  }, [from, peaks, width]);

  const beginDrag = (event: ReactPointerEvent<HTMLElement>, word: number, kind: DragKind) => {
    const target = line.words[word];
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { kind, word, startX: event.clientX, start: target.start, end: target.end };
    onSelect({ line: lineIndex, word });
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>, final: boolean) => {
    const drag = dragRef.current;
    if (drag === null) {
      return;
    }
    const deltaSec = (event.clientX - drag.startX) / PX_PER_SEC;
    if (final) {
      dragRef.current = null;
    }
    // A click without movement only selects.
    if (final && Math.abs(deltaSec) < 0.005) {
      return;
    }
    onTimesChange({
      ref: { line: lineIndex, word: drag.word },
      ...draggedTimes(drag, deltaSec),
      final,
    });
  };

  const handlers = (word: number, kind: DragKind) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => beginDrag(event, word, kind),
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => moveDrag(event, false),
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => moveDrag(event, true),
  });

  return (
    <div className="overflow-x-auto">
      <div className="relative h-16 rounded-md bg-muted/40" style={{ width }}>
        <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-hidden="true" />
        <button
          type="button"
          className="absolute inset-0 size-full cursor-text"
          aria-label={t('timingEditor.seekInLine', { line: lineIndex + 1 })}
          tabIndex={-1}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            onSeek(from + (event.clientX - box.left) / PX_PER_SEC);
          }}
        />
        {line.words.map((word, wi) => (
          <div
            key={word.id}
            className={cn(
              'absolute top-2 bottom-2 flex items-stretch rounded border text-xs select-none',
              word.noSing === true
                ? 'border-dashed border-muted-foreground/60 bg-muted/70 text-muted-foreground'
                : 'border-primary/50 bg-primary/20',
              selectedWord === wi && 'ring-2 ring-primary',
            )}
            style={{
              left: toX(word.start),
              width: Math.max(6, (word.end - word.start) * PX_PER_SEC),
            }}
          >
            <span
              className="w-1.5 shrink-0 cursor-ew-resize rounded-l bg-primary/60"
              aria-hidden="true"
              {...handlers(wi, 'start')}
            />
            <button
              type="button"
              className="min-w-0 flex-1 cursor-grab truncate px-1 text-left"
              aria-pressed={selectedWord === wi}
              {...handlers(wi, 'move')}
            >
              {word.text}
            </button>
            <span
              className="w-1.5 shrink-0 cursor-ew-resize rounded-r bg-primary/60"
              aria-hidden="true"
              {...handlers(wi, 'end')}
            />
          </div>
        ))}
        {playhead === null ? null : (
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-red-500"
            style={{ left: toX(playhead) }}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}

export const LineStrip = memo(LineStripImpl);
