import { BoxIcon, Trash2Icon, VideoIcon, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo } from 'react';

import { useDialog, type ClearCacheTarget } from '@/features/menu/hooks/use-dialog';
import { useMenuFocus } from '@/features/menu/providers/menu-focus-context';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/components/ui/tooltip';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';
import { cn } from '@/shared/utils/cn';

type CacheButton = {
  icon: LucideIcon;
  label: string;
  target: ClearCacheTarget;
};

type CacheActionsProps = {
  focusedSidebarIndex: number;
  registerCallback: (callback: ((subIndex: number) => void) | null) => void;
};

export const CacheActions = ({ focusedSidebarIndex, registerCallback }: CacheActionsProps) => {
  const { focus, actionsRef } = useMenuFocus();
  const { setMode } = useDialog();

  const buttons = useMemo<CacheButton[]>(
    () => [
      { icon: Trash2Icon, label: 'menu.sidebar.cacheActions.clearAllCache', target: 'all' },
      { icon: VideoIcon, label: 'menu.sidebar.cacheActions.clearVideosCache', target: 'videos' },
      { icon: BoxIcon, label: 'menu.sidebar.cacheActions.clearModelsCache', target: 'models' },
    ],
    [],
  );

  const setModeRef = useLatestRef(setMode);

  useEffect(() => {
    const map = actionsRef.current.sidebarSubCountByIndex;
    map.set(focusedSidebarIndex, buttons.length);

    registerCallback((subIndex: number) => {
      const button = buttons.at(subIndex);
      if (!button) {
        return;
      }
      setModeRef.current({ mode: 'clear-cache', target: button.target });
    });

    return () => {
      map.delete(focusedSidebarIndex);
      registerCallback(null);
    };
  }, [actionsRef, buttons, focusedSidebarIndex, registerCallback, setModeRef]);

  const isSidebarActive = focus.active && focus.panel === 'sidebar';
  const isClusterFocused = isSidebarActive && focus.sidebarIndex === focusedSidebarIndex;

  return (
    <div data-sidebar-nav-index={focusedSidebarIndex} className="flex items-center gap-0.5">
      {buttons.map((button, index) => {
        const Icon = button.icon;
        const isButtonFocused = isClusterFocused && focus.sidebarSubIndex === index;

        return (
          <Tooltip key={button.label}>
            <TooltipTrigger asChild>
              <Button
                tabIndex={-1}
                variant="ghost"
                size="icon-xs"
                aria-label={t(button.label)}
                onClick={() => setMode({ mode: 'clear-cache', target: button.target })}
                data-sidebar-sub-index={index}
                className={cn(
                  'text-sidebar-foreground/70 hover:bg-transparent hover:text-sidebar-foreground/70 focus-visible:ring-0 focus-visible:border-transparent dark:hover:bg-transparent',
                  isButtonFocused && 'ring-2 ring-primary bg-sidebar-accent',
                )}
              >
                <Icon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t(button.label)}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
};
