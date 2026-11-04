import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import type { NavAction } from '@/app/providers/nav-input-context';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';

import { useNavInput } from './use-nav-input';

/**
 * Focusables that confirm/back can target. Must stay in sync with how dialogs
 * lay out controls; scope `containerRef` so order matches your `stops` / counts.
 */
export const DIALOG_FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[role="combobox"]:not([disabled])',
  '[role="slider"]:not([data-disabled])',
].join(', ');

/** Ignore confirm on the first frames after open (avoids acting on the same press that opened the dialog). */
const CONFIRM_DEBOUNCE_MS = 150;

function getVisibleFocusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetWidth > 0 || el.offsetHeight > 0,
  );
}

/**
 * Maps (segment, slot) to a single index into `getVisibleFocusables` order.
 * `segmentSizes[i]` = number of focusables in vertical segment (row) `i`.
 */
function flatIndexFromSegmentLayout(
  segmentSizes: readonly number[],
  segmentIndex: number,
  slotWithinSegment: number,
): number {
  let flat = 0;
  for (let s = 0; s < segmentIndex; s++) {
    flat += segmentSizes[s] ?? 0;
  }
  return flat + slotWithinSegment;
}

function isInsideMenuOrListbox(el: Element | null): boolean {
  return el?.closest('[role="menu"], [role="listbox"]') !== null;
}

/**
 * Radix Select / dropdowns use internal keyboard handling. We translate nav
 * actions into synthetic key events on the focused control.
 */
function dispatchMenuKeyFromNav(focused: HTMLElement, action: NavAction): void {
  let key: string | null = null;
  if (action.up) {
    key = 'ArrowUp';
  } else if (action.down) {
    key = 'ArrowDown';
  } else if (action.confirm) {
    key = 'Enter';
  } else if (action.back) {
    key = 'Escape';
  }
  if (key !== null) {
    focused.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  }
}

export type UseDialogNavOptions = {
  open: boolean;
  /**
   * When `stops` is omitted: number of single-focusable segments (typical
   * horizontal Cancel / OK strip). Each item is one focusable in order under
   * `containerRef`.
   */
  itemCount: number;
  /**
   * When set: each value is how many consecutive focusables form one vertical
   * “segment”. Up/down move between segments; left/right move within a segment
   * when its size is greater than 1. Sum of entries must match focusables
   * under `containerRef` in DOM order.
   */
  stops?: number[];
  onBack: () => void;
  /** If set, called on confirm instead of clicking the focused element. */
  onConfirm?: (flatIndex: number) => void;
  /**
   * Optional per-segment hook fired before default navigation handling. Return
   * `true` to mark the action as consumed and skip default segment movement
   * / confirm / click. Use for segments that need custom value adjustment
   * (sliders, steppers) where left/right shouldn't traverse focusables.
   */
  onAction?: (segment: number, slot: number, action: NavAction) => boolean | void;
  /** Root used to resolve focusables and optional `.click()` on confirm. */
  containerRef?: RefObject<HTMLElement | null>;
  /** Keep the previous virtual focus when an existing surface is temporarily covered. */
  resetOnOpen?: boolean;
};

type OpenTransitionSetters = {
  setSegment: (value: number) => void;
  setSlot: (value: number) => void;
};

function useOpenTransition(
  open: boolean,
  resetOnOpen: boolean,
  setters: OpenTransitionSetters,
): boolean {
  const [wasOpen, setWasOpen] = useState(open);
  const justOpened = open && !wasOpen;

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && resetOnOpen) {
      setters.setSegment(0);
      setters.setSlot(0);
    }
  }

  return justOpened;
}

const shouldResetDialog = (value: boolean | undefined): boolean => value !== false;

const visibleFocusIndex = (open: boolean, index: number): number => (open ? index : 0);

const dialogSegments = (stops: number[] | undefined, itemCount: number): number[] =>
  stops ?? Array.from({ length: itemCount }, () => 1);

type DialogPositionInput = {
  justOpened: boolean;
  resetOnOpen: boolean;
  segmentIndex: number;
  slotInSegment: number;
  segmentSizes: readonly number[];
};

function clampDialogPosition(input: DialogPositionInput) {
  const segmentCount = input.segmentSizes.length;
  const segment =
    input.justOpened && input.resetOnOpen
      ? 0
      : Math.min(Math.max(0, input.segmentIndex), Math.max(0, segmentCount - 1));
  const slotCount = input.segmentSizes[segment] ?? 1;
  const slot =
    input.justOpened && input.resetOnOpen
      ? 0
      : Math.min(Math.max(0, input.slotInSegment), slotCount - 1);

  return { segment, slot, slotCount };
}

/**
 * Gamepad / keyboard-style navigation for modal dialogs subscribed to
 * {@link NavInputContext}. Drives a virtual focus ring via `focusedIndex` or
 * `isFocused`, and performs confirm/back by clicking the matching element or
 * calling `onConfirm`.
 *
 * **Two layouts**
 *
 * 1. **Uniform strip** — only `itemCount` (no `stops`). Behaves like a single
 *    row: left/right wrap between items; up/down also move between items.
 *    Use when you have N buttons in one row.
 *
 * 2. **Segmented rows** — pass `stops: [2, 1, 1, …]`. Each number is the
 *    width of one row. Up/down change row; left/right move inside a row when
 *    width > 1.
 */
export function useDialogNav({
  open,
  itemCount,
  onConfirm,
  onBack,
  onAction,
  stops,
  containerRef,
  resetOnOpen,
}: UseDialogNavOptions) {
  const shouldResetOnOpen = shouldResetDialog(resetOnOpen);
  const segmentSizes = useMemo(() => dialogSegments(stops, itemCount), [stops, itemCount]);

  const segmentCount = segmentSizes.length;

  const [segmentIndex, setSegmentIndex] = useState(0);
  const [slotInSegment, setSlotInSegment] = useState(0);

  const onBackRef = useLatestRef(onBack);
  const onConfirmRef = useLatestRef(onConfirm);
  const onActionRef = useLatestRef(onAction);

  const justOpened = useOpenTransition(open, shouldResetOnOpen, {
    setSegment: setSegmentIndex,
    setSlot: setSlotInSegment,
  });

  const openedAtMsRef = useRef(0);

  useEffect(() => {
    if (open) {
      openedAtMsRef.current = performance.now();
    }
  }, [open]);

  const {
    segment: clampedSegmentIndex,
    slot: clampedSlot,
    slotCount: slotsThisSegment,
  } = clampDialogPosition({
    justOpened,
    resetOnOpen: shouldResetOnOpen,
    segmentIndex,
    slotInSegment,
    segmentSizes,
  });

  const flatFocusedIndex = flatIndexFromSegmentLayout(
    segmentSizes,
    clampedSegmentIndex,
    clampedSlot,
  );

  const useSegmentedHorizontalNav = Boolean(stops);

  useEffect(() => {
    if (!open || !containerRef?.current) {
      return;
    }
    const focusables = getVisibleFocusables(containerRef.current);
    focusables[flatFocusedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, flatFocusedIndex, containerRef]);

  const handleNav = useCallback(
    (action: NavAction) => {
      if (!open || segmentCount === 0) {
        return;
      }

      const active = document.activeElement;
      if (isInsideMenuOrListbox(active)) {
        if (active instanceof HTMLElement) {
          dispatchMenuKeyFromNav(active, action);
        }
        return;
      }

      if (onActionRef.current?.(clampedSegmentIndex, clampedSlot, action) === true) {
        return;
      }

      const handleConfirmOrBack = (): boolean => {
        if (action.back) {
          onBackRef.current();
          return true;
        }
        if (!action.confirm) {
          return false;
        }
        if (performance.now() - openedAtMsRef.current < CONFIRM_DEBOUNCE_MS) {
          return true;
        }
        if (onConfirmRef.current) {
          onConfirmRef.current(flatFocusedIndex);
        } else if (containerRef?.current) {
          getVisibleFocusables(containerRef.current)[flatFocusedIndex]?.click();
        }
        return true;
      };

      const handleHorizontal = (): boolean => {
        if (!action.left && !action.right) {
          return false;
        }
        const delta = action.left ? -1 : 1;
        if (useSegmentedHorizontalNav && slotsThisSegment > 1) {
          setSlotInSegment((prev) => Math.min(slotsThisSegment - 1, Math.max(0, prev + delta)));
        } else if (!useSegmentedHorizontalNav) {
          setSegmentIndex((prev) => (prev + delta + segmentCount) % segmentCount);
        }
        return true;
      };

      const handleVertical = (): void => {
        if (action.up) {
          setSegmentIndex((prev) => (prev <= 0 ? segmentCount - 1 : prev - 1));
          setSlotInSegment(0);
        } else if (action.down) {
          setSegmentIndex((prev) => (prev >= segmentCount - 1 ? 0 : prev + 1));
          setSlotInSegment(0);
        }
      };

      if (handleConfirmOrBack() || handleHorizontal()) {
        return;
      }
      handleVertical();
    },
    [
      open,
      segmentCount,
      clampedSegmentIndex,
      clampedSlot,
      flatFocusedIndex,
      slotsThisSegment,
      useSegmentedHorizontalNav,
      containerRef,
      onActionRef,
      onBackRef,
      onConfirmRef,
    ],
  );

  useNavInput(handleNav);

  const focusSegment = useCallback(
    (segment: number, slot: number = 0) => {
      if (!open) {
        return;
      }
      const nextSegment = Math.min(Math.max(0, segment), Math.max(0, segmentCount - 1));
      const nextSlots = segmentSizes[nextSegment] ?? 1;
      setSegmentIndex(nextSegment);
      setSlotInSegment(Math.min(Math.max(0, slot), nextSlots - 1));
    },
    [open, segmentCount, segmentSizes],
  );

  return {
    /** Index into the in-order list of focusables under `containerRef`. */
    focusedIndex: visibleFocusIndex(open, flatFocusedIndex),
    /** For segmented layouts: `isFocused(row, column)` with `stops`-shaped coordinates. */
    isFocused: (segment: number, slot: number = 0): boolean =>
      open && clampedSegmentIndex === segment && clampedSlot === slot,
    /** Move the virtual focus ring from pointer/focus interactions. */
    focusSegment,
  };
}
