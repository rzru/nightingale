import {
  ChevronsUpDownIcon,
  CogIcon,
  DoorOpenIcon,
  DownloadIcon,
  HeartIcon,
  InfoIcon,
  QrCodeIcon,
  RefreshCcwDotIcon,
  TrophyIcon,
  UserIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { EXIT_SUPPORTED } from '@/bridge/exit';
import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useDonationSeen } from '@/features/menu/hooks/use-donation-seen';
import { useNavInput } from '@/features/menu/hooks/use-nav-input';
import { useMenuFocus } from '@/features/menu/providers/menu-focus-context';
import { useCurrentProfile } from '@/features/profiles/hooks/use-current-profile';
import { RemoteControlDialog } from '@/features/remote/remote-control-dialog';
import { useShouldRunSetup } from '@/features/setup/hooks/use-should-run-setup';
import { useUpdate } from '@/features/updates/queries/use-update';
import { t } from '@/i18n';
import { Avatar, AvatarFallback } from '@/shared/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/shared/components/ui/sidebar';
import { useIsMobile } from '@/shared/hooks/use-is-mobile';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';

type ActionsProps = {
  registerCallback: (callback: (() => void) | null) => void;
  focusedSidebarIndex: number;
};

const profileInitials = (profile: string | null | undefined): string =>
  typeof profile === 'string' && profile !== '' ? profile.slice(0, 2).toLocaleUpperCase() : 'NP';

const profileDialog = (profile: string | null | undefined): 'select-profile' | 'create-profile' =>
  typeof profile === 'string' && profile !== '' ? 'select-profile' : 'create-profile';

const menuPlacement = (mobile: boolean): { side: 'top' | 'right'; align: 'start' | 'end' } =>
  mobile ? { side: 'top', align: 'start' } : { side: 'right', align: 'end' };

const AvatarBadge = ({ update, donation }: { update: boolean; donation: boolean }) => {
  if (!update && !donation) {
    return null;
  }

  return (
    <span
      aria-label={t(update ? 'menu.sidebar.updateAvailable' : 'menu.sidebar.supportNightingale')}
      className={`absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-sidebar ${
        update ? 'bg-chart-3' : 'bg-pink-500'
      }`}
    />
  );
};

export const Actions = ({ registerCallback, focusedSidebarIndex }: ActionsProps) => {
  const { setMode } = useDialog();
  const { setOpen } = useSidebar();
  const navigate = useNavigate();
  const profile = useCurrentProfile();
  const { focus, actionsRef } = useMenuFocus();
  const { setShouldRunSetup } = useShouldRunSetup();

  const update = useUpdate();
  const updateAvailable = update.status === 'available';

  const { seen: donationSeen } = useDonationSeen();
  const showDonationBadge = !donationSeen;
  const showDonationAvatarBadge = showDonationBadge && !updateAvailable;

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const isMobile = useIsMobile();
  const dropdownOpenRef = useLatestRef(dropdownOpen);

  useEffect(() => {
    const actions = actionsRef.current;

    registerCallback(() => {
      setDropdownOpen(true);

      setTimeout(() => {
        const firstItem = document.querySelector('[role="menu"] [role="menuitem"]');

        if (firstItem instanceof HTMLElement) {
          firstItem.focus();
        }
      }, 50);
    });

    actions.onSidebarBack = () => {
      if (dropdownOpenRef.current) {
        setDropdownOpen(false);

        return true;
      }
      return false;
    };

    actions.isSidebarBusy = () => dropdownOpenRef.current;

    return () => {
      registerCallback(null);

      actions.onSidebarBack = null;
      actions.isSidebarBusy = null;
    };
  }, [actionsRef, dropdownOpenRef, registerCallback]);

  useNavInput(
    useCallback(
      (action) => {
        if (!dropdownOpenRef.current) {
          return;
        }

        const focused = document.activeElement;

        if (action.up || action.down) {
          const key = action.up ? 'ArrowUp' : 'ArrowDown';

          if (focused) {
            focused.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
          }
        }

        if (action.confirm) {
          if (focused instanceof HTMLElement) {
            focused.click();
          }
        }
      },
      [dropdownOpenRef],
    ),
  );

  const isSidebarActive = focus.active && focus.panel === 'sidebar';
  const placement = menuPlacement(isMobile);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              tabIndex={-1}
              size="lg"
              data-sidebar-nav-index={focusedSidebarIndex}
              className={`data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground hover:ring-primary ${
                isSidebarActive && focus.sidebarIndex === focusedSidebarIndex
                  ? 'ring-2 ring-primary bg-sidebar-accent'
                  : ''
              }`}
            >
              <div className="relative">
                <Avatar>
                  <AvatarFallback>{profileInitials(profile)}</AvatarFallback>
                </Avatar>
                <AvatarBadge update={updateAvailable} donation={showDonationAvatarBadge} />
              </div>
              <span className="truncate font-medium">
                {profile ?? t('menu.sidebar.noSelectedProfile')}
              </span>
              <ChevronsUpDownIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={placement.side}
            align={placement.align}
            collisionPadding={8}
            className="min-w-56"
          >
            <DropdownMenuLabel>{t('menu.sidebar.actions.setup')}</DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setShouldRunSetup(true)}>
                <RefreshCcwDotIcon />
                {t('menu.sidebar.actions.reRunSetup')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('settings.tabs.general')}</DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  setMode(profileDialog(profile));
                }}
              >
                <UserIcon />
                {t('menu.sidebar.actions.profile')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setMode('leaderboards')}>
                <TrophyIcon />
                {t('menu.sidebar.actions.leaderboards')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setDropdownOpen(false);
                  if (isMobile) {
                    setOpen(false);
                  }
                  // Open on the next tick so the menu can finish closing; Radix
                  // leaves a dialog unclickable when it mounts mid-close.
                  setTimeout(() => setRemoteOpen(true), 0);
                }}
              >
                <QrCodeIcon />
                {t('menu.sidebar.actions.remote')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setDropdownOpen(false);
                  if (isMobile) {
                    setOpen(false);
                  }
                  void navigate('/settings');
                }}
              >
                <CogIcon />
                {t('common.settings')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setMode('update')}>
                <DownloadIcon />
                <span>{t('menu.sidebar.actions.update')}</span>
                {updateAvailable && (
                  <span
                    aria-label={t('menu.sidebar.actions.updateAvailable')}
                    className="ml-auto size-2 rounded-full bg-chart-3"
                  />
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setMode('donate')}>
                <HeartIcon />
                <span>{t('menu.sidebar.actions.donate')}</span>
                {showDonationBadge && (
                  <span
                    aria-label={t('menu.sidebar.actions.supportNightingale')}
                    className="ml-auto size-2 rounded-full bg-pink-500"
                  />
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setMode('about')}>
                <InfoIcon />
                {t('menu.sidebar.actions.about')}
              </DropdownMenuItem>
              {EXIT_SUPPORTED && (
                <DropdownMenuItem onClick={() => setMode('exit')}>
                  <DoorOpenIcon />
                  {t('menu.sidebar.actions.exit')}
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      <RemoteControlDialog open={remoteOpen} onOpenChange={setRemoteOpen} />
    </SidebarMenu>
  );
};
