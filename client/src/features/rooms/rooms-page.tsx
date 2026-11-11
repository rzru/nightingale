import { ArrowUpRightIcon, ChevronRightIcon, InfoIcon, PlusIcon } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { openUrl } from '@/bridge/opener';
import type { Joining, RoomSummary } from '@/bridge/rooms';
import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useCurrentProfile } from '@/features/profiles/hooks/use-current-profile';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { Separator } from '@/shared/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/components/ui/tooltip';

import { NodeTable } from './components/node-table';
import { NodeVersion, Ping } from './components/ping';
import { RoomTable } from './components/room-table';
import { RoomView } from './components/room-view';
import { useNodes, type RoomNode } from './hooks/use-nodes';
import { useRooms, type RoomSession } from './hooks/use-room';
import { forgetNode, rememberNode } from './lib/known-nodes';
import { clearPlaybackExit } from './lib/playback-launch';
import { readRoomReturn } from './lib/room-return';

const NODE_DOCS_URL = 'https://nightingale.cafe/docs/rooms/#run-a-node';

const DocsLink = ({ href, label }: { href: string; label: string }) => (
  <button
    type="button"
    onClick={() => void openUrl(href).catch(() => undefined)}
    className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
  >
    {label}
    <ArrowUpRightIcon className="size-3" aria-hidden="true" />
  </button>
);

const Section = ({
  action,
  children,
  description,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  description: ReactNode;
  title: string;
}) => (
  <section className="space-y-3">
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="truncate text-sm font-medium">{title}</h2>
        {action}
      </div>
      <div className="text-xs text-muted-foreground">{description}</div>
    </div>
    {children}
  </section>
);

/**
 * Drill-down header. The parent is a breadcrumb so the way back is a place, not
 * a button competing with the title; version rides beside the name as metadata.
 */
const LevelHeader = ({
  action,
  meta,
  onParent,
  parent,
  title,
  version,
}: {
  action?: ReactNode;
  meta: ReactNode;
  onParent: () => void;
  parent: string;
  title: string;
  version: string;
}) => (
  <div className="space-y-1.5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <nav aria-label={parent} className="flex min-w-0 items-baseline gap-1.5">
        <button
          type="button"
          onClick={onParent}
          className="shrink-0 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {parent}
        </button>
        <ChevronRightIcon
          className="size-3.5 shrink-0 self-center text-muted-foreground/60"
          aria-hidden="true"
        />
        <h2 className="truncate text-sm font-medium" aria-current="page">
          {title}
        </h2>
        <NodeVersion version={version} />
      </nav>
      {action}
    </div>
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{meta}</div>
  </div>
);

/** Rooms identify singers by profile, so the name is not something to type. */
const ProfileSlot = ({
  onSelectProfile,
  profile,
}: {
  onSelectProfile: () => void;
  profile: string | undefined;
}) => {
  if (profile === undefined) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onSelectProfile}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:border-ring hover:text-foreground"
          >
            <InfoIcon className="size-3" aria-hidden="true" />
            {t('rooms.profileRequired.title')}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{t('rooms.profileRequired.body')}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs">
      <span className="text-muted-foreground">{t('rooms.singingAs')}</span>
      <span className="font-medium">{profile}</span>
    </span>
  );
};

const ProfileGate = ({ onSelectProfile }: { onSelectProfile: () => void }) => (
  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-input/10 p-4">
    <div className="space-y-1">
      <p className="text-sm font-medium">{t('rooms.profileRequired.title')}</p>
      <p className="text-xs text-muted-foreground">{t('rooms.profileRequired.body')}</p>
    </div>
    <Button onClick={onSelectProfile}>{t('rooms.profileRequired.action')}</Button>
  </div>
);

const NodesLevel = ({
  nodes,
  onAdd,
  onOpen,
  onRemove,
}: {
  nodes: RoomNode[];
  onAdd: (url: string) => void;
  onOpen: (url: string) => void;
  onRemove: (url: string) => void;
}) => (
  <Section
    title={t('rooms.nodes.title')}
    description={`${t('rooms.nodes.description')} ${t('rooms.nodes.trust')}`}
    action={<DocsLink href={NODE_DOCS_URL} label={t('rooms.docs.runNode')} />}
  >
    <NodeTable nodes={nodes} onAdd={onAdd} onOpen={onOpen} onRemove={onRemove} />
  </Section>
);

const NodeLevel = ({
  node,
  onBack,
  onJoined,
  profile,
  rooms,
}: {
  node: RoomNode;
  onBack: () => void;
  onJoined: (joining: Joining) => void;
  profile: string;
  rooms: RoomSummary[];
}) => {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <section className="space-y-3">
      <LevelHeader
        parent={t('rooms.nodes.title')}
        title={node.name}
        version={node.info.version}
        onParent={onBack}
        meta={
          <>
            <Ping rttMs={node.rttMs} />
            <span className="tabular-nums">
              {t('rooms.node.roomsUsed', {
                used: node.info.rooms.used,
                capacity: node.info.rooms.capacity,
              })}
            </span>
          </>
        }
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon />
            {t('rooms.rooms.create')}
          </Button>
        }
      />
      <RoomTable
        createOpen={createOpen}
        node={node}
        rooms={rooms}
        singerName={profile}
        onCreatedOpenChange={setCreateOpen}
        onJoined={onJoined}
      />
    </section>
  );
};

export const RoomsPage = () => {
  const { setMode } = useDialog();
  const location = useLocation();
  const navigate = useNavigate();
  const profile = useCurrentProfile();
  const { data: nodes = [], refetch } = useNodes();
  const [openNodeUrl, setOpenNodeUrl] = useState<string | null>(null);
  // Playback hands the seat back so a finished song returns to its room.
  const [session, setSession] = useState<RoomSession | null>(() => readRoomReturn(location.state));

  useEffect(() => {
    if (readRoomReturn(location.state) === null) {
      return;
    }

    void navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  const openNode = useMemo(
    () => nodes.find((node) => node.url === openNodeUrl) ?? null,
    [nodes, openNodeUrl],
  );
  const rooms = useRooms(openNode?.url ?? null);
  const selectProfile = () => setMode('select-profile');

  const body = (): ReactNode => {
    if (profile === undefined) {
      return <ProfileGate onSelectProfile={selectProfile} />;
    }

    if (session !== null) {
      return (
        <RoomView
          session={session}
          onLeave={() => {
            clearPlaybackExit();
            setSession(null);
          }}
        />
      );
    }

    if (openNode !== null) {
      return (
        <NodeLevel
          node={openNode}
          profile={profile}
          rooms={rooms.data ?? []}
          onBack={() => setOpenNodeUrl(null)}
          onJoined={(joining) => setSession({ nodeUrl: openNode.url, joining })}
        />
      );
    }

    return (
      <NodesLevel
        nodes={nodes}
        onOpen={setOpenNodeUrl}
        onAdd={(url) => {
          rememberNode(url);
          setOpenNodeUrl(url);
          void refetch();
        }}
        onRemove={(url) => {
          forgetNode(url);
          void refetch();
        }}
      />
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t('rooms.title')}</h1>
            <p className="max-w-prose text-sm text-muted-foreground">{t('rooms.subtitle')}</p>
          </div>
          <ProfileSlot profile={profile} onSelectProfile={selectProfile} />
        </div>
      </header>

      <Separator />

      {body()}
    </div>
  );
};
