import { LibraryBigIcon } from 'lucide-react';
import { useEffect } from 'react';

import { useMenuFocus } from '@/features/menu/providers/menu-focus-context';
import { useSourceButtons } from '@/features/sources/hooks/use-source-buttons';
import { t } from '@/i18n';
import { SidebarGroup, SidebarMenu, SidebarMenuItem } from '@/shared/components/ui/sidebar';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';

import { SourceActionButton } from './source-action-button';

type FolderActionsProps = {
  focusedSidebarIndex: number;
  registerCallback: (callback: ((subIndex: number) => void) | null) => void;
};

/**
 * Sidebar "Library" cluster — renders the source action buttons and wires
 * them into the menu's keyboard nav system. State derivation lives in
 * `useSourceButtons`; per-button presentation lives in `SourceActionButton`.
 */
export const FolderActions = ({ focusedSidebarIndex, registerCallback }: FolderActionsProps) => {
  const { focus, actionsRef } = useMenuFocus();
  const buttons = useSourceButtons();

  const buttonsRef = useLatestRef(buttons);

  useEffect(() => {
    const map = actionsRef.current.sidebarSubCountByIndex;
    map.set(focusedSidebarIndex, buttons.length);

    registerCallback((subIndex: number) => {
      const button = buttonsRef.current.at(subIndex);
      if (!button || button.disabled) {
        return;
      }
      button.handler();
    });

    return () => {
      map.delete(focusedSidebarIndex);
      registerCallback(null);
    };
  }, [actionsRef, buttons.length, buttonsRef, focusedSidebarIndex, registerCallback]);

  const isClusterFocused =
    focus.active && focus.panel === 'sidebar' && focus.sidebarIndex === focusedSidebarIndex;

  return (
    <SidebarGroup>
      <SidebarMenu>
        <SidebarMenuItem>
          <div
            data-sidebar-nav-index={focusedSidebarIndex}
            className="flex w-full items-center justify-between gap-2 rounded-[calc(var(--radius-sm)+2px)] px-2 py-1.5 text-xs"
          >
            <span className="flex items-center gap-2 text-sidebar-foreground/70">
              <LibraryBigIcon className="size-4 shrink-0" />
              {t('menu.sidebar.folderActions.library')}
            </span>
            <div className="flex items-center gap-0.5">
              {buttons.map((button, index) => (
                <SourceActionButton
                  key={button.key}
                  icon={button.icon}
                  label={button.label}
                  tooltip={button.tooltip}
                  disabled={button.disabled}
                  focused={isClusterFocused && focus.sidebarSubIndex === index}
                  badge={button.badge}
                  onClick={button.handler}
                  subIndex={index}
                />
              ))}
            </div>
          </div>
        </SidebarMenuItem>
      </SidebarMenu>
      <div aria-hidden className="mx-auto mt-1 h-px w-full rounded-full bg-sidebar-border/80" />
    </SidebarGroup>
  );
};
