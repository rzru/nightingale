import { QrCodeIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { useMenuFocus } from '@/features/menu/providers/menu-focus-context';
import { RemoteControlDialog, RemoteQr } from '@/features/remote/remote-control-dialog';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/shared/components/ui/hover-card';
import { cn } from '@/shared/utils/cn';

type RemoteConnectProps = {
  className?: string;
  focusedSidebarIndex: number;
  registerCallback: (callback: (() => void) | null) => void;
};

/**
 * One permanent entry point for the phone link: hovering shows the QR code
 * straight away, clicking (or the gamepad/keyboard slot) opens the full dialog
 * for touch screens and for copying the URL.
 */
export const RemoteConnect = ({
  className,
  focusedSidebarIndex,
  registerCallback,
}: RemoteConnectProps) => {
  const { focus } = useMenuFocus();
  const [open, setOpen] = useState(false);

  const openDialog = useCallback(() => setOpen(true), []);

  useEffect(() => {
    registerCallback(openDialog);
    return () => registerCallback(null);
  }, [openDialog, registerCallback]);

  const isFocused =
    focus.active && focus.panel === 'sidebar' && focus.sidebarIndex === focusedSidebarIndex;

  return (
    <>
      <HoverCard openDelay={120} closeDelay={60}>
        <HoverCardTrigger asChild>
          <Button
            tabIndex={-1}
            variant="ghost"
            size="icon-xs"
            aria-label={t('remote.control.openLabel')}
            onClick={openDialog}
            data-sidebar-nav-index={focusedSidebarIndex}
            className={cn(
              'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-0 focus-visible:border-transparent',
              isFocused && 'ring-2 ring-primary bg-sidebar-accent',
              className,
            )}
          >
            <QrCodeIcon aria-hidden="true" />
          </Button>
        </HoverCardTrigger>
        <HoverCardContent side="right" align="start" className="w-64 border p-3 ring-0">
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-0.5 text-center">
              <p className="text-sm font-medium">{t('remote.control.title')}</p>
              <p className="text-[0.7rem] leading-snug text-muted-foreground">
                {t('remote.control.description')}
              </p>
            </div>
            <RemoteQr size="preview" />
          </div>
        </HoverCardContent>
      </HoverCard>

      <RemoteControlDialog open={open} onOpenChange={setOpen} />
    </>
  );
};
