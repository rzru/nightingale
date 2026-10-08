import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

import {
  downloadSong,
  getInitialDeepLink,
  onDeepLinkDownload,
  onDownloadDone,
  onDownloadProgress,
} from '@/bridge/deep-link';
import type { UnlistenFn } from '@/bridge/runtime';
import { Progress } from '@/shared/components/ui/progress';
import { Spinner } from '@/shared/components/ui/spinner';
import { useConfig } from '@/shared/config/use-config';

type ParsedDeepLink = { url: string; title: string; host: string };

/** Parse `nightingale://download?url=<encoded>&title=<optional>`. Returns null
 * for anything malformed or missing a valid http(s) download URL. */
const parseDeepLink = (raw: string): ParsedDeepLink | null => {
  let outer: URL;
  try {
    outer = new URL(raw);
  } catch {
    return null;
  }
  const url = outer.searchParams.get('url');
  if (url === null || url === '') {
    return null;
  }
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  return { url, title: outer.searchParams.get('title') ?? '', host };
};

const DownloadToast = ({ title, pct }: { title: string; pct: number | null }) => (
  <div className="flex w-full flex-col gap-1.5">
    <span className="text-sm">
      {title !== '' ? `Downloading “${title}”…` : 'Downloading song…'}
    </span>
    {pct === null ? <Spinner className="size-4" /> : <Progress value={pct} />}
  </div>
);

/**
 * Listens for `nightingale://download?url=…` deep links (cold- and warm-start)
 * and downloads the song into the library, showing a discreet toast with an
 * inline progress bar. Trusted hosts (config allowlist) download directly; any
 * other host is confirmed first. Always mounted; renders nothing.
 */
export const DeepLinkListener = () => {
  const { data: config } = useConfig();
  const toastIdRef = useRef<string | number | null>(null);
  const titleRef = useRef('');

  const startDownload = useCallback((url: string, title: string) => {
    titleRef.current = title;
    toastIdRef.current = toast.loading(<DownloadToast title={title} pct={0} />);
    downloadSong(url, title === '' ? null : title);
  }, []);

  // Persistent listeners that keep the active download toast up to date.
  useEffect(() => {
    const state: { unlisten: UnlistenFn[]; cancelled: boolean } = {
      unlisten: [],
      cancelled: false,
    };
    void (async () => {
      const onProgress = await onDownloadProgress((p) => {
        if (toastIdRef.current === null) {
          return;
        }
        const pct =
          p.total !== null && p.total > 0 ? Math.round((p.received / p.total) * 100) : null;
        toast.loading(<DownloadToast title={titleRef.current} pct={pct} />, {
          id: toastIdRef.current,
        });
      });
      const onDone = await onDownloadDone((d) => {
        if (toastIdRef.current === null) {
          return;
        }
        if (d.ok) {
          toast.success(
            titleRef.current !== '' ? `Added “${titleRef.current}”` : 'Song added to your library',
            { id: toastIdRef.current },
          );
        } else {
          toast.error(`Download failed: ${d.error ?? 'unknown error'}`, { id: toastIdRef.current });
        }
        toastIdRef.current = null;
      });
      if (state.cancelled) {
        onProgress();
        onDone();
      } else {
        state.unlisten = [onProgress, onDone];
      }
    })();
    return () => {
      state.cancelled = true;
      state.unlisten.forEach((u) => u());
    };
  }, []);

  const handleDeepLink = useCallback(
    (raw: string) => {
      const parsed = parseDeepLink(raw);
      if (parsed === null) {
        toast.error('Invalid Nightingale link');
        return;
      }
      const { url, title, host } = parsed;
      const allowed = config?.deep_link_allowed_hosts ?? [];
      if (allowed.includes(host)) {
        startDownload(url, title);
        return;
      }
      toast(`Download ${title !== '' ? `“${title}”` : 'this song'} from ${host}?`, {
        duration: 15000,
        action: { label: 'Download', onClick: () => startDownload(url, title) },
        cancel: { label: 'Cancel', onClick: () => undefined },
      });
    },
    [config?.deep_link_allowed_hosts, startDownload],
  );

  useEffect(() => {
    const state: { unlisten: UnlistenFn | null; cancelled: boolean } = {
      unlisten: null,
      cancelled: false,
    };
    void (async () => {
      const unlisten = await onDeepLinkDownload(handleDeepLink);
      if (state.cancelled) {
        unlisten();
      } else {
        state.unlisten = unlisten;
      }
    })();
    const initial = getInitialDeepLink();
    if (initial !== null && initial !== '') {
      handleDeepLink(initial);
    }
    return () => {
      state.cancelled = true;
      state.unlisten?.();
    };
  }, [handleDeepLink]);

  return null;
};
