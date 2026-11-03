import { MoonIcon, SunIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo } from 'react';

import { useTheme } from '@/app/providers/theme-context';
import { useMenuFocus } from '@/features/menu/providers/menu-focus-context';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/components/ui/tooltip';
import { useConfigMutation } from '@/shared/config/use-config-mutation';
import { cn } from '@/shared/utils/cn';

type ThemeToggleProps = {
  className?: string;
  focusedSidebarIndex: number;
  registerCallback: (callback: (() => void) | null) => void;
};

export const ThemeToggle = ({
  className,
  focusedSidebarIndex,
  registerCallback,
}: ThemeToggleProps) => {
  const { focus } = useMenuFocus();
  const { toggle, theme } = useTheme();
  const { mutate } = useConfigMutation();

  const { Icon, label } = useMemo(() => {
    return theme === 'dark'
      ? { Icon: SunIcon, label: 'menu.sidebar.themeToggle.lightMode' }
      : { Icon: MoonIcon, label: 'menu.sidebar.themeToggle.darkMode' };
  }, [theme]);

  const handleToggle = useCallback(() => {
    toggle();
    mutate({ dark_mode: theme !== 'dark' });
  }, [mutate, theme, toggle]);

  useEffect(() => {
    registerCallback(handleToggle);
    return () => registerCallback(null);
  }, [handleToggle, registerCallback]);

  const isFocused =
    focus.active && focus.panel === 'sidebar' && focus.sidebarIndex === focusedSidebarIndex;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          tabIndex={-1}
          variant="ghost"
          size="icon-xs"
          aria-label={t(label)}
          onClick={handleToggle}
          data-sidebar-nav-index={focusedSidebarIndex}
          className={cn(
            'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-0 focus-visible:border-transparent',
            isFocused && 'ring-2 ring-primary bg-sidebar-accent',
            className,
          )}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{t(label)}</TooltipContent>
    </Tooltip>
  );
};
