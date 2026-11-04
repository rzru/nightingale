import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { loadRemoteInfo, type RemoteInfo } from '@/bridge/remote-control';
import { t } from '@/i18n';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/components/ui/dialog';

const REMOTE_INFO = ['remote-control'];

const qrDataUrl = (svg: string): string => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

type RemoteLinkProps = {
  info: RemoteInfo | undefined;
  error: unknown;
  loading: boolean;
};

function RemoteLink({ info, error, loading }: RemoteLinkProps) {
  if (loading) {
    return null;
  }

  if (info === undefined || info.url === null) {
    return error === null && info === undefined ? null : (
      <p className="text-sm text-muted-foreground">{t('remote.control.unavailable')}</p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <img
        src={qrDataUrl(info.qrSvg ?? '')}
        alt={t('remote.control.title')}
        className="size-56 rounded-md bg-white p-2"
      />
      <p className="w-full break-all text-center font-mono text-xs text-muted-foreground">
        {info.url}
      </p>
    </div>
  );
}

type RemoteControlDialogProps = {
  /** Optional trigger element; omit to drive the dialog with `open`. */
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/** Host side of the phone link: the QR code phones scan to control Nightingale. */
export function RemoteControlDialog({
  children,
  open: controlledOpen,
  onOpenChange,
}: RemoteControlDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const { data, error, isLoading } = useQuery({
    queryKey: REMOTE_INFO,
    queryFn: loadRemoteInfo,
    enabled: open,
    retry: false,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children === undefined ? null : <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('remote.control.title')}</DialogTitle>
          <DialogDescription>{t('remote.control.description')}</DialogDescription>
        </DialogHeader>

        <RemoteLink info={data} error={error} loading={isLoading} />
      </DialogContent>
    </Dialog>
  );
}
