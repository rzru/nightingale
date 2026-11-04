import { useQuery } from '@tanstack/react-query';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { loadRemoteInfo, type RemoteInfo } from '@/bridge/remote-control';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Spinner } from '@/shared/components/ui/spinner';

const REMOTE_INFO = ['remote-control'];

const qrDataUrl = (svg: string): string => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

/** The hover preview stays small; the dialog can afford a roomier code. */
export type RemoteQrSize = 'preview' | 'dialog';

const QR_FRAME: Record<RemoteQrSize, string> = {
  preview: 'size-40 p-2.5',
  dialog: 'size-52 p-3',
};

type RemoteLinkProps = {
  info: RemoteInfo | undefined;
  error: unknown;
  loading: boolean;
  size: RemoteQrSize;
};

function QrFrame({ size, children }: { size: RemoteQrSize; children: React.ReactNode }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-xl bg-white text-muted-foreground shadow-sm ring-1 ring-black/10 ${QR_FRAME[size]}`}
    >
      {children}
    </div>
  );
}

const COPY_FEEDBACK_MS = 1500;

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return undefined;
    }

    const id = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    return () => clearTimeout(id);
  }, [copied]);

  // Missing clipboard API on insecure origins and denied permission both reject.
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      toast.error(t('remote.control.copyFailed'));
    }
  };

  const label = copied ? t('remote.control.copied') : t('remote.control.copyLink');

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-xs"
      aria-label={label}
      title={label}
      onClick={() => void copy()}
    >
      {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
    </Button>
  );
}

function RemoteLink({ info, error, loading, size }: RemoteLinkProps) {
  if (loading) {
    return (
      <QrFrame size={size}>
        <Spinner />
      </QrFrame>
    );
  }

  if (info === undefined || info.url === null) {
    return error === null && info === undefined ? null : (
      <p className="text-sm text-muted-foreground">{t('remote.control.unavailable')}</p>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col items-center gap-2">
      <QrFrame size={size}>
        <img
          src={qrDataUrl(info.qrSvg ?? '')}
          alt={t('remote.control.title')}
          className="size-full"
        />
      </QrFrame>
      <div className="flex w-full items-center gap-1.5">
        <p className="min-w-0 flex-1 break-all text-center font-mono text-[0.6rem] text-muted-foreground">
          {info.url}
        </p>
        <CopyLinkButton url={info.url} />
      </div>
    </div>
  );
}

/**
 * The QR code and URL a phone scans. Shared by the hover preview and the
 * dialog so both always show the same pairing target.
 */
export function RemoteQr({ size = 'dialog' }: { size?: RemoteQrSize }) {
  const { data, error, isLoading } = useQuery({
    queryKey: REMOTE_INFO,
    queryFn: loadRemoteInfo,
    retry: false,
  });

  return <RemoteLink info={data} error={error} loading={isLoading} size={size} />;
}

type RemoteControlDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Host side of the phone link: the QR code phones scan to control Nightingale. */
export function RemoteControlDialog({ open, onOpenChange }: RemoteControlDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('remote.control.title')}</DialogTitle>
          <DialogDescription>{t('remote.control.description')}</DialogDescription>
        </DialogHeader>

        <RemoteQr />
      </DialogContent>
    </Dialog>
  );
}
