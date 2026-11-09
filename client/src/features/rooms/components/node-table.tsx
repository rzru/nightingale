import { useMutation } from '@tanstack/react-query';
import { CheckCircle2Icon, Loader2Icon, ServerIcon, XCircleIcon, XIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { normalizeNodeUrl, probeNode, ROOMS_PROTOCOL } from '@/bridge/rooms';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/shared/components/ui/empty';
import { Input } from '@/shared/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/components/ui/tooltip';

import type { RoomNode } from '../hooks/use-nodes';
import { Ping } from './ping';

const testIcon = (busy: boolean, success: boolean, failed: boolean): ReactNode => {
  if (busy) {
    return <Loader2Icon className="animate-spin" />;
  }

  if (success) {
    return <CheckCircle2Icon className="text-chart-3" />;
  }

  return failed ? <XCircleIcon className="text-destructive" /> : null;
};

const testTooltip = (probe: {
  data: { name: string; rttMs: number } | undefined;
  error: unknown;
  isError: boolean;
  isSuccess: boolean;
}): string => {
  if (probe.isError) {
    return probe.error instanceof Error ? probe.error.message : t('rooms.nodes.unreachable');
  }

  if (probe.isSuccess && probe.data !== undefined) {
    return t('rooms.nodes.reachable', { name: probe.data.name, ms: probe.data.rttMs });
  }

  return t('rooms.nodes.test');
};

const testNode = async (target: string) => {
  const probe = await probeNode(target);

  if (probe.info === null) {
    throw new Error(t('rooms.nodes.unreachable'));
  }

  if (probe.info.protocol !== ROOMS_PROTOCOL) {
    throw new Error(t('rooms.nodes.protocolMismatch', { version: probe.info.version }));
  }

  return { name: probe.info.name, rttMs: probe.rttMs ?? 0 };
};

/**
 * Test-then-add, matching how Jellyfin/Plex/Navidrome sources connect: nothing
 * is remembered until the node answers.
 */
const AddNode = ({ onAdd }: { onAdd: (url: string) => void }) => {
  const [draft, setDraft] = useState('');
  const url = normalizeNodeUrl(draft);
  const probe = useMutation({ mutationFn: testNode });
  const resetProbe = probe.reset;
  const busy = probe.isPending;

  const change = (value: string) => {
    setDraft(value);

    if (probe.status !== 'idle') {
      resetProbe();
    }
  };

  const add = () => {
    if (url === null || !probe.isSuccess) {
      return;
    }

    onAdd(url);
    setDraft('');
    resetProbe();
  };

  const icon = testIcon(busy, probe.isSuccess, probe.isError);
  const tooltip = testTooltip(probe);

  const plaintext = url !== null && url.startsWith('http://');

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input
            value={draft}
            onChange={(event) => change(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                add();
              }
            }}
            placeholder={t('rooms.nodes.addPlaceholder')}
            aria-label={t('rooms.nodes.addPlaceholder')}
            aria-invalid={draft.trim() !== '' && url === null}
            aria-describedby={plaintext ? 'rooms-node-caution' : undefined}
            disabled={busy}
          />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              disabled={url === null || busy}
              aria-label={t('rooms.nodes.test')}
              onClick={() => {
                if (url !== null) {
                  probe.mutate(url);
                }
              }}
            >
              {icon}
              {t('rooms.nodes.test')}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
        <Button disabled={!probe.isSuccess} onClick={add}>
          {t('rooms.nodes.add')}
        </Button>
      </div>

      {plaintext && (
        <p id="rooms-node-caution" className="text-xs text-muted-foreground">
          {t('rooms.nodes.plaintext')}
        </p>
      )}
    </div>
  );
};

export function NodeTable({
  nodes,
  onAdd,
  onOpen,
  onRemove,
}: {
  nodes: RoomNode[];
  onAdd: (url: string) => void;
  onOpen: (url: string) => void;
  onRemove: (url: string) => void;
}) {
  return (
    <div className="space-y-3">
      <AddNode onAdd={onAdd} />

      {nodes.length === 0 ? (
        <Empty className="border border-dashed border-border bg-input/10 py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ServerIcon />
            </EmptyMedia>
            <EmptyTitle>{t('rooms.nodes.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('rooms.nodes.empty')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('rooms.table.node')}</TableHead>
              <TableHead className="w-24">{t('rooms.table.ping')}</TableHead>
              <TableHead className="w-24">{t('rooms.table.rooms')}</TableHead>
              <TableHead className="w-24">{t('rooms.table.singers')}</TableHead>
              <TableHead className="w-20 text-right">
                <span className="sr-only">{t('rooms.table.action')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {nodes.map((node) => (
              <TableRow key={node.url} className="cursor-pointer" onClick={() => onOpen(node.url)}>
                <TableCell>
                  <button
                    type="button"
                    onClick={() => onOpen(node.url)}
                    className="block max-w-full truncate text-left font-medium hover:underline"
                  >
                    {node.name}
                  </button>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {node.info.version}
                  </span>
                </TableCell>
                <TableCell>
                  <Ping rttMs={node.rttMs} />
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {node.info.rooms.used}/{node.info.rooms.capacity}
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {node.info.slots.used}/{node.info.slots.capacity}
                </TableCell>
                <TableCell className="text-right">
                  {node.added && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('rooms.nodes.remove')}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemove(node.url);
                      }}
                    >
                      <XIcon />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
