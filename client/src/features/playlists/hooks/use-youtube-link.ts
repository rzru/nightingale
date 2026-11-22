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
  zen: 'Zen',
  librewolf: 'LibreWolf',
  floorp: 'Floorp',
  waterfox: 'Waterfox',
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
  /** Explicit choice from the picker; `null` searches every browser. */
  const [browser, setBrowser] = useState<string | null>(null);
  /** Default browser, where the sign-in page opens. */
  const [defaultBrowser, setDefaultBrowser] = useState<string | null>(null);
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
          setError(
            t('playlists.session.stillSignedOut', {
              browsers: result.tried.map((name) => browserLabel(name)).join(', '),
            }),
          );
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
    async (target: string | null, openOnSignedOut: string | null) => {
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
      setDefaultBrowser(session.detected_browser);
      await check(browser, session.sign_in_url);
    } catch (caught) {
      setError(t('playlists.session.readFailed', { value1: errorMessage(caught) }));
    }
  }, [browser, check]);

  const confirmSignedIn = useCallback(async () => {
    await check(browser, null);
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
    defaultBrowser,
    setBrowser,
    supported,
    error,
    start,
    confirmSignedIn,
    reopen,
    cancel,
  };
};
