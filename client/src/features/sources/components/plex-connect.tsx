import { Loader2Icon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { openUrl } from '@/bridge/opener';
import { plexBeginPin, plexManualLogin, plexPollPin } from '@/bridge/source';
import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import { SourceChangeWarning } from '@/features/sources/components/source-change-warning';
import { useConnectPlex } from '@/features/sources/mutations/use-source-mutations';
import { t, type TranslationKey } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Field, FieldGroup } from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { cn } from '@/shared/utils/cn';
import type { PlexPinStart } from '@/types/PlexPinStart';
import type { PlexServer } from '@/types/PlexServer';

type PlexViewState = {
  signInStatus: boolean;
  manualForm: boolean;
  serverForm: boolean;
  hostedActions: boolean;
  manualActions: boolean;
  connectAction: boolean;
};

const plexViewState = (hasServers: boolean, advanced: boolean, hasPin: boolean): PlexViewState => ({
  signInStatus: !hasServers && !advanced && hasPin,
  manualForm: !hasServers && advanced,
  serverForm: hasServers,
  hostedActions: !hasServers && !advanced,
  manualActions: !hasServers && advanced,
  connectAction: hasServers,
});

const selectedServer = (servers: readonly PlexServer[], index: number) => {
  const server = servers.at(index);
  return { server, sections: server?.sections ?? [] };
};

const plexCanConnect = (
  server: PlexServer | undefined,
  sectionIds: readonly string[],
  pending: boolean,
): boolean => Boolean(server) && sectionIds.length > 0 && !pending;

const signInCopy = (
  phase: 'waiting' | 'discovering',
  pin: PlexPinStart,
): { title: TranslationKey; detail: string } =>
  phase === 'waiting'
    ? {
        title: 'sources.plexConnect.waitingForApprovalInPlex',
        detail: t('sources.plex.approveCode', { code: pin.code }),
      }
    : {
        title: 'sources.plexConnect.signedInLookingForYourPlexServer',
        detail: t('sources.plex.discoveringServer'),
      };

const manualCredentialsReady = (url: string, token: string): boolean =>
  url.trim() !== '' && token !== '';

const BusyIcon = ({ active }: { active: boolean }) =>
  active ? <Loader2Icon className="animate-spin" /> : null;

const HostedSignInLabel = ({ pin }: { pin: PlexPinStart | null }) =>
  t(pin ? 'sources.plex.openSignIn' : 'sources.plex.signIn');

const PlexSignInStatus = ({
  visible,
  pin,
  phase,
}: {
  visible: boolean;
  pin: PlexPinStart | null;
  phase: 'waiting' | 'discovering';
}) => {
  if (!visible || pin === null) {
    return null;
  }
  const copy = signInCopy(phase, pin);
  return (
    <output
      className="-mt-2 flex items-start gap-2 rounded-md bg-muted px-3 py-2.5 text-xs"
      aria-live="polite"
    >
      <Loader2Icon className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" />
      <div className="space-y-0.5">
        <p className="font-medium text-foreground">{t(copy.title)}</p>
        <p className="text-muted-foreground">{copy.detail}</p>
      </div>
    </output>
  );
};

export const PlexConnectDialog = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { mode, close } = useDialog();
  const open = mode === 'plex-connect';
  const [advanced, setAdvanced] = useState(false);
  const [pin, setPin] = useState<PlexPinStart | null>(null);
  const [servers, setServers] = useState<PlexServer[]>([]);
  const [serverIndex, setServerIndex] = useState(0);
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const [manualUrl, setManualUrl] = useState('');
  const [manualToken, setManualToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [signInPhase, setSignInPhase] = useState<'waiting' | 'discovering'>('waiting');
  const polling = useRef(false);
  const connect = useConnectPlex();

  const { server, sections } = selectedServer(servers, serverIndex);
  const hasServers = servers.length > 0;
  const view = plexViewState(hasServers, advanced, pin !== null);
  const canConnect = plexCanConnect(server, sectionIds, connect.isPending);
  const { focusedIndex } = useDialogNav({
    open,
    itemCount: hasServers ? 2 : 3,
    onBack: close,
    containerRef,
  });
  const navClass = (index: number) =>
    cn(
      'focus-visible:ring-0 focus-visible:border-transparent',
      focusedIndex === index && 'ring-2 ring-primary',
    );

  useEffect(() => {
    if (!open || !pin || servers.length > 0) {
      return undefined;
    }
    let cancelled = false;

    const poll = async () => {
      if (polling.current) {
        return;
      }
      polling.current = true;
      const discoveryTimer = window.setTimeout(() => {
        if (!cancelled) {
          setSignInPhase('discovering');
        }
      }, 1_500);
      try {
        const result = await plexPollPin({ pinId: pin.pin_id, clientId: pin.client_id });
        if (cancelled) {
          return;
        }
        if (!result.authorized) {
          setSignInPhase('waiting');
          return;
        }
        setPin(null);
        setServers(result.servers);
        setServerIndex(0);
        if (result.servers.length === 0) {
          toast.error(t('sources.plexConnect.plexSignInSucceededButDescription'));
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(
            t('sources.plexConnect.plexSignInFailed', {
              value1: error instanceof Error ? error.message : String(error),
            }),
          );
          setPin(null);
        }
      } finally {
        window.clearTimeout(discoveryTimer);
        polling.current = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, pin, servers.length]);

  const selectedSummary = sections
    .filter((section) => sectionIds.includes(section.id))
    .map((section) => section.title);

  const startHostedSignIn = async () => {
    setBusy(true);
    try {
      const nextPin = await plexBeginPin();
      setPin(nextPin);
      await openUrl(nextPin.auth_url);
    } catch (error) {
      toast.error(
        t('sources.plexConnect.couldNotStartPlexSignIn', {
          value1: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const verifyManualServer = async () => {
    if (!manualUrl.trim() || !manualToken) {
      return;
    }
    setBusy(true);
    try {
      const discovered = await plexManualLogin({
        baseUrl: manualUrl.trim().replace(/\/+$/, ''),
        accessToken: manualToken,
      });
      setServers([discovered]);
      setServerIndex(0);
      setManualToken('');
    } catch (error) {
      toast.error(
        t('sources.plexConnect.couldNotReachPlex', {
          value1: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleConnect = () => {
    if (!server || sectionIds.length === 0) {
      return;
    }
    connect.mutate(
      { server, sectionIds },
      {
        onSuccess: () => {
          toast.success(
            t('sources.plexConnect.libraryNowReadsFrom', {
              value1: selectedSummary.join(', '),
              value2: server.server_name,
            }),
          );
          close();
        },
        onError: (error) =>
          toast.error(t('sources.plexConnect.couldNotConnectPlex', { value1: error.message })),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('sources.plexConnect.connectToPlex')}</DialogTitle>
          <DialogDescription>
            {t('sources.plexConnect.connectThroughPlexOnTheDescription')}
          </DialogDescription>
        </DialogHeader>

        <SourceChangeWarning />

        <PlexSignInStatus visible={view.signInStatus} pin={pin} phase={signInPhase} />

        {view.manualForm && (
          <FieldGroup>
            <Field>
              <Label htmlFor="plex-url">{t('sources.plexConnect.plexMediaServerUrl')}</Label>
              <Input
                id="sources.plexConnect.plexUrl"
                placeholder="https://plex.example.com:32400"
                value={manualUrl}
                onChange={(event) => setManualUrl(event.target.value)}
                disabled={busy}
              />
            </Field>
            <Field>
              <Label htmlFor="plex-token">{t('sources.plexConnect.plexToken')}</Label>
              <Input
                id="sources.plexConnect.plexToken2"
                type="password"
                autoComplete="off"
                value={manualToken}
                onChange={(event) => setManualToken(event.target.value)}
                disabled={busy}
              />
            </Field>
          </FieldGroup>
        )}

        {view.serverForm && (
          <div className="space-y-4">
            <Field>
              <Label htmlFor="plex-server">{t('sources.plexConnect.server')}</Label>
              <Select
                value={String(serverIndex)}
                onValueChange={(value) => {
                  setServerIndex(Number(value));
                  setSectionIds([]);
                }}
              >
                <SelectTrigger id="sources.plexConnect.plexServer" className="w-full">
                  <SelectValue placeholder={t('sources.plexConnect.selectAServer')} />
                </SelectTrigger>
                <SelectContent position="popper" className="w-[var(--radix-select-trigger-width)]">
                  {servers.map((candidate, index) => (
                    <SelectItem
                      key={`${candidate.server_id}:${candidate.server_url}`}
                      value={String(index)}
                    >
                      {candidate.server_name}
                      {candidate.owned ? '' : t('sources.plex.sharedSuffix')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="space-y-2">
              <Label>{t('sources.plexConnect.musicLibraries')}</Label>
              {sections.length === 0 ? (
                <p className="text-sm text-destructive">
                  {t('sources.plexConnect.thisServerDidNotExposeDescription')}
                </p>
              ) : (
                sections.map((section) => (
                  <label key={section.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={sectionIds.includes(section.id)}
                      onCheckedChange={(checked) =>
                        setSectionIds((current) =>
                          checked === true
                            ? [...current, section.id]
                            : current.filter((id) => id !== section.id),
                        )
                      }
                    />
                    {section.title}
                  </label>
                ))
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <div
            ref={containerRef}
            className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"
          >
            <Button
              variant="outline"
              onClick={close}
              disabled={busy || connect.isPending}
              className={navClass(0)}
            >
              {t('common.actions.cancel')}
            </Button>
            {view.hostedActions && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setAdvanced(true)}
                  disabled={busy}
                  className={navClass(1)}
                >
                  {t('sources.plexConnect.advanced')}
                </Button>
                <Button
                  onClick={() => {
                    if (pin === null) {
                      void startHostedSignIn();
                      return;
                    }
                    void openUrl(pin.auth_url);
                  }}
                  disabled={busy}
                  className={navClass(2)}
                >
                  <BusyIcon active={busy} />
                  <HostedSignInLabel pin={pin} />
                </Button>
              </>
            )}
            {view.manualActions && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setAdvanced(false)}
                  disabled={busy}
                  className={navClass(1)}
                >
                  {t('common.actions.back')}
                </Button>
                <Button
                  onClick={() => void verifyManualServer()}
                  disabled={busy || !manualCredentialsReady(manualUrl, manualToken)}
                  className={navClass(2)}
                >
                  <BusyIcon active={busy} />
                  {t('sources.plexConnect.testServer')}
                </Button>
              </>
            )}
            {view.connectAction && (
              <Button onClick={handleConnect} disabled={!canConnect} className={navClass(1)}>
                <BusyIcon active={connect.isPending} />
                {t('sources.plexConnect.connectSelectedLibraries')}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
