import { useCallback } from 'react';

import type { PlaybackCommand } from '@/bridge/playback-status';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import type { PlaybackAction } from '@/features/playback/lib/playback-actions';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/utils/cn';

const RING = 'ring-2 ring-primary';
const NO_FOCUS_RING = 'focus-visible:ring-0 focus-visible:border-transparent';

type PlaybackActionButtonsProps = {
  actions: PlaybackAction[];
  onCommand: (command: PlaybackCommand) => void;
  /** Enables keyboard/gamepad focus rings for the surface that owns the screen. */
  open: boolean;
  /** Back input on this surface; the caller decides what it means. */
  onBack?: () => void;
  disabled?: boolean;
  className?: string;
  /** Touch surfaces need taller buttons than the TV/desktop overlay. */
  buttonClassName?: string;
};

/**
 * Renders the action list from `playbackActions`. Shared by every surface that
 * offers playback actions so the buttons, their order, and their focus order
 * cannot drift apart.
 */
export function PlaybackActionButtons({
  actions,
  onCommand,
  open,
  onBack,
  disabled,
  className,
  buttonClassName,
}: PlaybackActionButtonsProps) {
  const confirm = useCallback(
    (index: number) => {
      const action = actions.at(index);
      if (action !== undefined) {
        onCommand(action.command);
      }
    },
    [actions, onCommand],
  );
  const { focusedIndex } = useDialogNav({
    open,
    itemCount: actions.length,
    onConfirm: confirm,
    onBack: onBack ?? (() => undefined),
  });

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {actions.map((action, index) => (
        <Button
          key={action.command}
          type="button"
          variant={action.variant}
          disabled={disabled}
          className={cn(NO_FOCUS_RING, open && focusedIndex === index && RING, buttonClassName)}
          onClick={() => onCommand(action.command)}
        >
          {t(action.labelKey)}
        </Button>
      ))}
    </div>
  );
}
