import { lineBounds, type EditorLine } from './model';

/** Horizontal scale of a line strip. */
export const PX_PER_SEC = 160;
/** Time shown before the first and after the last word of a line. */
export const STRIP_MARGIN_SEC = 0.6;

/** Whether the playhead falls inside the strip drawn for a line. */
export function playheadInLine(line: EditorLine, time: number): boolean {
  const bounds = lineBounds(line);
  return time >= bounds.start - STRIP_MARGIN_SEC && time <= bounds.end + STRIP_MARGIN_SEC;
}
