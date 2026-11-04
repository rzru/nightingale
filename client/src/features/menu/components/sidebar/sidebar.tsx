import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';

import { useMenuFocus } from '@/features/menu/providers/menu-focus-context';
import {
  Sidebar as ShadCnSidebar,
  SidebarFooter,
  SidebarProvider,
  SidebarSeparator,
} from '@/shared/components/ui/sidebar';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';

import { Actions } from './actions';
import { Header } from './header';
import { MainNavigation } from './main-navigation';
import { Stats } from './stats';

const REMOTE_SLOT_INDEX = 0;
const THEME_SLOT_INDEX = REMOTE_SLOT_INDEX + 1;
const FOLDER_SLOT_INDEX = THEME_SLOT_INDEX + 1;
const MAIN_NAV_BASE_INDEX = FOLDER_SLOT_INDEX + 1;

type SidebarCallback = () => void;
type SidebarSubCallback = (subIndex: number) => void;

export const Sidebar = ({ children }: PropsWithChildren<{}>) => {
  const { focus, actionsRef, setFocus } = useMenuFocus();
  const [mainNavigationCallbacks, setMainNavigationCallbacks] = useState<SidebarCallback[]>([]);

  const focusRef = useLatestRef(focus);
  const remoteCallbackRef = useRef<SidebarCallback | null>(null);
  const themeCallbackRef = useRef<SidebarCallback | null>(null);
  const folderCallbackRef = useRef<SidebarSubCallback | null>(null);
  const cacheCallbackRef = useRef<SidebarSubCallback | null>(null);
  const actionsCallbackRef = useRef<SidebarCallback | null>(null);

  const cacheSlotIndex = MAIN_NAV_BASE_INDEX + mainNavigationCallbacks.length;
  const actionsSlotIndex = cacheSlotIndex + 1;
  const sidebarCount = actionsSlotIndex + 1;

  const registerRemoteCallback = useCallback((callback: (() => void) | null) => {
    remoteCallbackRef.current = callback;
  }, []);

  const registerThemeCallback = useCallback((callback: (() => void) | null) => {
    themeCallbackRef.current = callback;
  }, []);

  const registerMainNavigationCallbacks = useCallback((callbacks: SidebarCallback[]) => {
    setMainNavigationCallbacks(callbacks);
  }, []);

  const registerFolderCallback = useCallback((callback: SidebarSubCallback | null) => {
    folderCallbackRef.current = callback;
  }, []);

  const registerCacheCallback = useCallback((callback: SidebarSubCallback | null) => {
    cacheCallbackRef.current = callback;
  }, []);

  const registerActionsCallback = useCallback((callback: SidebarCallback | null) => {
    actionsCallbackRef.current = callback;
  }, []);

  const sidebarCallbacks = useMemo(
    () => [
      () => remoteCallbackRef.current?.(),
      () => themeCallbackRef.current?.(),
      () => folderCallbackRef.current?.(focusRef.current.sidebarSubIndex),
      ...mainNavigationCallbacks,
      () => cacheCallbackRef.current?.(focusRef.current.sidebarSubIndex),
      () => actionsCallbackRef.current?.(),
    ],
    [focusRef, mainNavigationCallbacks],
  );
  const confirmSidebarSlot = useCallback(
    (index: number) => sidebarCallbacks.at(index)?.(),
    [sidebarCallbacks],
  );

  const clampSidebarFocus = useCallback(() => {
    setFocus((prev) => {
      const sidebarIndex = Math.min(prev.sidebarIndex, sidebarCount - 1);
      return sidebarIndex === prev.sidebarIndex ? prev : { ...prev, sidebarIndex };
    });
  }, [setFocus, sidebarCount]);

  useEffect(() => {
    const actions = actionsRef.current;
    actions.sidebarCount = sidebarCount;
    actions.onConfirmSidebar = confirmSidebarSlot;
    clampSidebarFocus();

    return () => {
      actions.onConfirmSidebar = null;
      actions.sidebarCount = 0;
    };
  }, [actionsRef, clampSidebarFocus, confirmSidebarSlot, sidebarCount]);

  return (
    <SidebarProvider>
      <ShadCnSidebar>
        <Header
          remoteIndex={REMOTE_SLOT_INDEX}
          registerRemoteCallback={registerRemoteCallback}
          themeIndex={THEME_SLOT_INDEX}
          registerThemeCallback={registerThemeCallback}
        />

        <MainNavigation
          baseIndex={MAIN_NAV_BASE_INDEX}
          registerCallbacks={registerMainNavigationCallbacks}
          folderFocusedSidebarIndex={FOLDER_SLOT_INDEX}
          registerFolderCallback={registerFolderCallback}
        />

        <SidebarFooter>
          <Stats
            cacheFocusedSidebarIndex={cacheSlotIndex}
            registerCacheCallback={registerCacheCallback}
          />
          <SidebarSeparator />
          <Actions
            focusedSidebarIndex={actionsSlotIndex}
            registerCallback={registerActionsCallback}
          />
        </SidebarFooter>
      </ShadCnSidebar>
      {children}
    </SidebarProvider>
  );
};
