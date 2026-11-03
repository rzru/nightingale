import type { UseMutationResult } from '@tanstack/react-query';
import { CheckCircle2Icon, Loader2Icon, XCircleIcon } from 'lucide-react';
import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { toast } from 'sonner';

import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import { SourceChangeWarning } from '@/features/sources/components/source-change-warning';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Field, FieldGroup } from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/components/ui/tooltip';
import { cn } from '@/shared/utils/cn';

const normaliseUrl = (raw: string) => raw.trim().replace(/\/+$/, '');

type RemoteSourceForm = {
  baseUrl: string;
  username: string;
  password: string;
};

const EMPTY_FORM: RemoteSourceForm = { baseUrl: '', username: '', password: '' };

type RemoteLoginResult = {
  server_name?: string | null;
  server_url: string;
};

type SelectableItem = { id: string; label: string };

const reachedHostName = (login: RemoteLoginResult | undefined): string | null | undefined =>
  login?.server_name ?? login?.server_url;

type ConnectVariables = RemoteSourceForm & { selectedIds: string[] };

const formReady = (form: RemoteSourceForm): boolean =>
  [form.baseUrl.trim(), form.username.trim(), form.password].every((value) => value.length > 0);

const selectionIsReady = (required: boolean, selectedIds: readonly string[]): boolean =>
  !required || selectedIds.length > 0;

const focusRing = (focusedIndex: number, index: number): string =>
  cn(
    'focus-visible:ring-0 focus-visible:border-transparent',
    focusedIndex === index && 'ring-2 ring-primary',
  );

const connectReady = (
  canSubmit: boolean,
  busy: boolean,
  tested: boolean,
  selectionReady: boolean,
): boolean => canSubmit && !busy && tested && selectionReady;

type SelectionListProps = {
  label: string;
  emptyMessage: ReactNode;
  items: SelectableItem[];
  selectedIds: string[];
  busy: boolean;
  onToggle: (id: string, checked: boolean) => void;
};

const SelectionList = ({
  label,
  emptyMessage,
  items,
  selectedIds,
  busy,
  onToggle,
}: SelectionListProps) => (
  <div className="space-y-2">
    <Label>{t(label)}</Label>
    {items.length === 0 ? (
      <p className="text-sm text-muted-foreground">
        {typeof emptyMessage === 'string' ? t(emptyMessage) : emptyMessage}
      </p>
    ) : (
      <div className="flex max-h-48 flex-wrap content-start gap-x-4 gap-y-2 overflow-y-auto overscroll-contain">
        {items.map((item) => (
          <label key={item.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              className="after:inset-0"
              checked={selectedIds.includes(item.id)}
              onCheckedChange={(checked) => onToggle(item.id, checked === true)}
              disabled={busy}
            />
            {item.label}
          </label>
        ))}
      </div>
    )}
  </div>
);

type RemoteSourceConnectDialogProps<TLogin extends RemoteLoginResult> = {
  mode: 'jellyfin-connect' | 'navidrome-connect';
  title: string;
  description: ReactNode;
  urlInputId: string;
  urlPlaceholder: string;
  usernameInputId: string;
  passwordInputId: string;
  loginMutation: UseMutationResult<TLogin, Error, RemoteSourceForm>;
  connectMutation: UseMutationResult<{ login: TLogin }, Error, ConnectVariables>;
  /**
   * Optional post-test selection step. When the test succeeds and this yields
   * items, the dialog shows a checkbox list and only enables Connect once at
   * least one item is picked. The chosen ids are forwarded to `useConnect`.
   */
  selection?: {
    label: string;
    emptyMessage: ReactNode;
    getItems: (login: TLogin) => SelectableItem[];
  };
};

export const RemoteSourceConnectDialog = <TLogin extends RemoteLoginResult>({
  mode: dialogMode,
  title,
  description,
  urlInputId,
  urlPlaceholder,
  usernameInputId,
  passwordInputId,
  loginMutation: testMutation,
  connectMutation,
  selection,
}: RemoteSourceConnectDialogProps<TLogin>) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { mode, close } = useDialog();
  const open = mode === dialogMode;

  const [form, setForm] = useState<RemoteSourceForm>(EMPTY_FORM);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const resetTest = testMutation.reset;

  // Editing any field resets the test pill back to idle so the user doesn't
  // get a stale green check on credentials that no longer match what they
  // typed — and clears any selection made against the old server.
  const updateField = (key: keyof RemoteSourceForm) => (e: ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
    if (testMutation.status !== 'idle') {
      resetTest();
      setSelectedIds([]);
    }
  };

  const selectableItems = testMutation.isSuccess
    ? (selection?.getItems(testMutation.data) ?? [])
    : [];
  // Only force a choice when there's actually something to choose. A server
  // that exposes no libraries (or a failed listing) falls back to importing
  // everything.
  const selectionRequired = Boolean(selection) && selectableItems.length > 0;

  const { focusedIndex } = useDialogNav({
    open,
    itemCount: 3,
    onBack: close,
    containerRef,
  });

  const canSubmit = formReady(form);

  const isBusy = [testMutation.isPending, connectMutation.isPending].some(Boolean);

  const credentials = () => ({
    baseUrl: normaliseUrl(form.baseUrl),
    username: form.username.trim(),
    password: form.password,
  });

  const handleTest = () => {
    if (!canSubmit || isBusy) {
      return;
    }
    testMutation.mutate(credentials(), {
      onError: (e) => toast.error(t('sources.connect.couldNotReachServer', { value1: e.message })),
    });
  };

  const canConnect = connectReady(
    canSubmit,
    isBusy,
    testMutation.isSuccess,
    selectionIsReady(selectionRequired, selectedIds),
  );

  const handleConnect = () => {
    if (!canConnect) {
      return;
    }
    connectMutation.mutate(
      { ...credentials(), selectedIds },
      {
        onSuccess: ({ login }) => {
          toast.success(
            t('sources.connect.libraryNowReadsFrom', {
              value1: login.server_name ?? login.server_url,
            }),
          );
          close();
        },
        onError: (e) => toast.error(t('sources.connect.loginFailed', { value1: e.message })),
      },
    );
  };

  const toggleSelected = (id: string, checked: boolean) =>
    setSelectedIds((current) =>
      checked ? [...current, id] : current.filter((existing) => existing !== id),
    );

  const reachedHost = reachedHostName(testMutation.data);

  const testState: {
    icon: ReactNode;
    tooltip: string;
  } = (() => {
    if (testMutation.isPending) {
      return {
        icon: <Loader2Icon className="size-4 animate-spin" />,
        tooltip: t('sources.connection.testing'),
      };
    }
    if (testMutation.isError) {
      return {
        icon: <XCircleIcon className="size-4 text-destructive" />,
        tooltip: t('sources.connection.reachError', { error: testMutation.error.message }),
      };
    }
    if (testMutation.isSuccess && typeof reachedHost === 'string' && reachedHost !== '') {
      return {
        icon: <CheckCircle2Icon className="size-4 text-chart-3" />,
        tooltip: t('sources.connection.reached', { host: reachedHost }),
      };
    }
    return { icon: null, tooltip: t('sources.connection.test') };
  })();

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <div className="contents">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <SourceChangeWarning />
          <FieldGroup>
            <Field>
              <Label htmlFor={urlInputId}>{t('sources.connect.serverUrl')}</Label>
              <Input
                id={urlInputId}
                placeholder={urlPlaceholder}
                value={form.baseUrl}
                onChange={updateField('baseUrl')}
                disabled={isBusy}
              />
            </Field>
            <Field>
              <Label htmlFor={usernameInputId}>{t('sources.connect.username')}</Label>
              <Input
                id={usernameInputId}
                autoComplete="username"
                value={form.username}
                onChange={updateField('username')}
                disabled={isBusy}
              />
            </Field>
            <Field>
              <Label htmlFor={passwordInputId}>{t('sources.connect.password')}</Label>
              <Input
                id={passwordInputId}
                type="password"
                autoComplete="current-password"
                value={form.password}
                onChange={updateField('password')}
                disabled={isBusy}
              />
            </Field>
          </FieldGroup>
          {selection && testMutation.isSuccess && (
            <SelectionList
              label={selection.label}
              emptyMessage={selection.emptyMessage}
              items={selectableItems}
              selectedIds={selectedIds}
              busy={isBusy}
              onToggle={toggleSelected}
            />
          )}
          <DialogFooter>
            <div
              ref={containerRef}
              className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"
            >
              <DialogClose asChild>
                <Button
                  variant="outline"
                  onClick={close}
                  disabled={isBusy}
                  className={focusRing(focusedIndex, 0)}
                >
                  {t('common.actions.cancel')}
                </Button>
              </DialogClose>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={!canSubmit || isBusy}
                    onClick={handleTest}
                    aria-label={testState.tooltip}
                    className={focusRing(focusedIndex, 1)}
                  >
                    {testState.icon}
                    {t('sources.connect.testConnection')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{testState.tooltip}</TooltipContent>
              </Tooltip>
              <Button
                disabled={!canConnect}
                onClick={handleConnect}
                className={focusRing(focusedIndex, 2)}
              >
                {t('sources.connect.connect')}
              </Button>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};
