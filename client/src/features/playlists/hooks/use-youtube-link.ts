import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { youtubeSessionBegin, youtubeSessionConnect } from '@/bridge/accounts';
import { openUrl } from '@/bridge/opener';
import { t } from '@/i18n';
import { ACCOUNTS, YOUTUBE_PLAYLISTS } from '@/shared/query-keys';
import type { SessionConnectResult } from '@/types/SessionConnectResult';

export type SessionPhase = 'idle' | 'checking' | 'waiting';

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Brand names stay untranslated. */
export const BROWSER_LABELS: Record<string, string> = {
  firefox: 'Firefox',
  chrome: 'Chrome',
  chromium: 'Chromium',
  brave: 'Brave',
  edge: 'Edge',
  opera: 'Opera',
  vivaldi: 'Vivaldi',
  safari: 'Safari',
};

export const browserLabel = (browser: string | null): string =>
  browser === null ? '' : (BROWSER_LABELS[browser] ?? browser);

/**
 * "Use my YouTube session": read the YouTube session of the default browser.
 * When the browser is not signed in, open YouTube there and wait for the
 * user to come back and confirm.
 */
export const useYoutubeSession = () => {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<SessionPhase>('idle');
  const [browser, setBrowser] = useState<string | null>(null);
  const [supported, setSupported] = useState<string[]>([]);
  const [signInUrl, setSignInUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onResult = useCallback(
    async (result: SessionConnectResult, openOnSignedOut: string | null) => {
      if (result.status === 'connected') {
        setPhase('idle');
        toast.success(
          t('playlists.account.linked', { name: result.account?.display_name ?? 'YouTube' }),
        );
        await queryClient.invalidateQueries({ queryKey: ACCOUNTS });
        await queryClient.invalidateQueries({ queryKey: YOUTUBE_PLAYLISTS });
        return;
      }
      if (result.status === 'not_signed_in') {
        setPhase('waiting');
        if (openOnSignedOut === null) {
          setError(t('playlists.session.stillSignedOut'));
        } else {
          await openUrl(openOnSignedOut);
        }
        return;
      }
      setPhase('idle');
      setError(t('playlists.session.readFailed', { value1: result.error ?? '' }));
    },
    [queryClient],
  );

  const check = useCallback(
    async (target: string, openOnSignedOut: string | null) => {
      setPhase('checking');
      setError(null);
      try {
        await onResult(await youtubeSessionConnect(target), openOnSignedOut);
      } catch (caught) {
        setPhase('idle');
        setError(t('playlists.session.readFailed', { value1: errorMessage(caught) }));
      }
    },
    [onResult],
  );

  const start = useCallback(async () => {
    try {
      const session = await youtubeSessionBegin();
      setSupported(session.supported_browsers);
      setSignInUrl(session.sign_in_url);
      const target = browser ?? session.detected_browser;
      if (target === null) {
        setError(t('playlists.session.noBrowser'));
        return;
      }
      setBrowser(target);
      await check(target, session.sign_in_url);
    } catch (caught) {
      setError(t('playlists.session.readFailed', { value1: errorMessage(caught) }));
    }
  }, [browser, check]);

  const confirmSignedIn = useCallback(async () => {
    if (browser !== null) {
      await check(browser, null);
    }
  }, [browser, check]);

  const reopen = useCallback(async () => {
    if (signInUrl !== null) {
      await openUrl(signInUrl);
    }
  }, [signInUrl]);

  const cancel = useCallback(() => {
    setPhase('idle');
    setError(null);
  }, []);

  return {
    phase,
    browser,
    setBrowser,
    supported,
    error,
    start,
    confirmSignedIn,
    reopen,
    cancel,
  };
};
