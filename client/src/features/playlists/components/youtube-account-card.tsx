import { CheckIcon, ExternalLinkIcon, LogOutIcon, YoutubeIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { browserLabel, useYoutubeSession } from '@/features/playlists/hooks/use-youtube-link';
import { useUnlinkYoutube } from '@/features/playlists/queries/use-playlists-mutations';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Spinner } from '@/shared/components/ui/spinner';
import type { LinkedAccount } from '@/types/LinkedAccount';

type Session = ReturnType<typeof useYoutubeSession>;

/** Picker value for "search every installed browser". */
const AUTO = 'auto';

const LinkedActions = ({ account }: { account: LinkedAccount }) => {
  const unlink = useUnlinkYoutube();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm">
        {t('playlists.session.connected', {
          name: account.display_name,
          browser: browserLabel(account.browser),
        })}
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={unlink.isPending}
        onClick={() => unlink.mutate()}
      >
        <LogOutIcon />
        {t('playlists.account.unlink')}
      </Button>
    </div>
  );
};

const BrowserPicker = ({ session }: { session: Session }) => {
  if (session.supported.length === 0) {
    return null;
  }
  return (
    <Select
      value={session.browser ?? AUTO}
      onValueChange={(value) => session.setBrowser(value === AUTO ? null : value)}
    >
      <SelectTrigger className="w-44" aria-label={t('playlists.session.browser')}>
        <SelectValue placeholder={t('playlists.session.browser')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={AUTO}>{t('playlists.session.anyBrowser')}</SelectItem>
        {session.supported.map((browser) => (
          <SelectItem key={browser} value={browser}>
            {browserLabel(browser)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

const Waiting = ({ session }: { session: Session }) => (
  <div className="flex flex-col gap-3">
    <p className="text-sm">
      {t('playlists.session.signInThenConfirm', {
        browser: browserLabel(session.browser ?? session.defaultBrowser),
      })}
    </p>
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => void session.confirmSignedIn()}>
        <CheckIcon />
        {t('playlists.session.done')}
      </Button>
      <Button variant="outline" onClick={() => void session.reopen()}>
        <ExternalLinkIcon />
        {t('playlists.session.reopen')}
      </Button>
      <Button variant="ghost" onClick={session.cancel}>
        {t('common.actions.cancel')}
      </Button>
      <BrowserPicker session={session} />
    </div>
  </div>
);

const Idle = ({ session }: { session: Session }) => (
  <div className="flex flex-col gap-3">
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={() => void session.start()}>
        <YoutubeIcon />
        {t('playlists.session.use')}
      </Button>
      <BrowserPicker session={session} />
    </div>
    {session.error !== null && <p className="text-sm text-destructive">{session.error}</p>}
  </div>
);

/** Start the search once when the page was opened from a "YouTube" button. */
const useAutoStart = (session: Session, enabled: boolean) => {
  const started = useRef(false);
  const { start } = session;

  useEffect(() => {
    if (enabled && !started.current) {
      started.current = true;
      void start();
    }
  }, [enabled, start]);
};

const SessionActions = ({ autoConnect }: { autoConnect: boolean }) => {
  const session = useYoutubeSession();
  useAutoStart(session, autoConnect);

  if (session.phase === 'checking') {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Spinner />
        {session.browser === null
          ? t('playlists.session.searching')
          : t('playlists.session.checking', { browser: browserLabel(session.browser) })}
      </div>
    );
  }
  if (session.phase === 'waiting') {
    return (
      <div className="flex flex-col gap-2">
        <Waiting session={session} />
        {session.error !== null && <p className="text-sm text-destructive">{session.error}</p>}
      </div>
    );
  }
  return <Idle session={session} />;
};

type YoutubeAccountCardProps = {
  account: LinkedAccount | null;
  /** Start looking for a session right away (opened from a "YouTube" button). */
  autoConnect: boolean;
};

export const YoutubeAccountCard = ({ account, autoConnect }: YoutubeAccountCardProps) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <YoutubeIcon className="size-5" />
        {t('playlists.account.title')}
      </CardTitle>
      <CardDescription>{t('playlists.session.description')}</CardDescription>
    </CardHeader>
    <CardContent>
      {account === null ? (
        <SessionActions autoConnect={autoConnect} />
      ) : (
        <LinkedActions account={account} />
      )}
    </CardContent>
  </Card>
);
