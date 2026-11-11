import { DoorOpenIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  createRoom,
  joinRoom,
  RoomRequestError,
  type Joining,
  type RoomSummary,
} from '@/bridge/rooms';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/shared/components/ui/empty';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';

import type { RoomNode } from '../hooks/use-nodes';
import { useRoomSongs, songLabel } from '../hooks/use-room-song';
import { denyMessage } from '../lib/deny-message';

const reasonOf = (cause: unknown): string =>
  cause instanceof RoomRequestError ? cause.reason : 'unknown';

const CreateRoomDialog = ({
  node,
  onJoined,
  onOpenChange,
  open,
  singerName,
}: {
  node: RoomNode;
  onJoined: (joining: Joining) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  singerName: string;
}) => {
  const [roomName, setRoomName] = useState('');
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState<string | null>(null);

  const close = () => {
    setRoomName('');
    setPassword('');
    setReason(null);
    onOpenChange(false);
  };

  const create = async () => {
    try {
      const joining = await createRoom(node.url, {
        name: roomName,
        hostName: singerName,
        password: password.trim() === '' ? null : password,
      });
      onJoined(joining);
      close();
    } catch (cause) {
      setReason(reasonOf(cause));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('rooms.rooms.create')}</DialogTitle>
          <DialogDescription>{t('rooms.create.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="room-name">{t('rooms.create.name')}</Label>
            <Input
              id="room-name"
              value={roomName}
              onChange={(event) => setRoomName(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="room-password">{t('rooms.create.password')}</Label>
            <Input
              id="room-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {reason !== null && (
            <p className="text-xs text-destructive" role="alert">
              {t(denyMessage(reason))}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {t('common.actions.cancel')}
          </Button>
          <Button onClick={() => void create()} disabled={roomName.trim() === ''}>
            {t('rooms.rooms.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const JoinRoomDialog = ({
  node,
  onClose,
  onJoined,
  room,
  singerName,
}: {
  node: RoomNode;
  onClose: () => void;
  onJoined: (joining: Joining) => void;
  room: RoomSummary | null;
  singerName: string;
}) => {
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState<string | null>(null);

  const close = () => {
    setPassword('');
    setReason(null);
    onClose();
  };

  const join = async () => {
    if (room === null) {
      return;
    }

    try {
      const joining = await joinRoom(node.url, room.id, {
        name: singerName,
        password: password.trim() === '' ? null : password,
      });
      onJoined(joining);
      close();
    } catch (cause) {
      setReason(reasonOf(cause));
    }
  };

  return (
    <Dialog open={room !== null} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{room?.name}</DialogTitle>
        </DialogHeader>
        {room?.locked === true && (
          <div className="space-y-1">
            <Label htmlFor="join-password">{t('rooms.create.password')}</Label>
            <Input
              id="join-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        )}
        {reason !== null && (
          <p className="text-xs text-destructive" role="alert">
            {t(denyMessage(reason))}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {t('common.actions.cancel')}
          </Button>
          <Button onClick={() => void join()}>{t('rooms.rooms.join')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export function RoomTable({
  createOpen,
  node,
  onCreatedOpenChange,
  onJoined,
  rooms,
  singerName,
}: {
  createOpen: boolean;
  node: RoomNode;
  onCreatedOpenChange: (open: boolean) => void;
  onJoined: (joining: Joining) => void;
  rooms: RoomSummary[];
  singerName: string;
}) {
  const [joinTarget, setJoinTarget] = useState<RoomSummary | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const { data: songs } = useRoomSongs(
    rooms.flatMap((room) =>
      room.trackHash === undefined || room.trackHash === null ? [] : [room.trackHash],
    ),
  );
  const localTitles = new Map((songs ?? []).map((song) => [song.file_hash, songLabel(song)]));

  const titleFor = (room: RoomSummary): string => {
    const hash = room.trackHash ?? null;
    const local = hash === null ? undefined : localTitles.get(hash);

    return local ?? room.trackTitle ?? t('rooms.room.noTrackYet');
  };

  // Open rooms join straight away; only a locked room needs the password step.
  const joinOpenRoom = async (room: RoomSummary) => {
    setJoiningId(room.id);

    try {
      const joining = await joinRoom(node.url, room.id, { name: singerName, password: null });
      onJoined(joining);
    } catch (cause) {
      toast.error(t(denyMessage(reasonOf(cause))));
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <div className="space-y-3">
      {rooms.length === 0 ? (
        <Empty className="border border-dashed border-border bg-input/10 py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <DoorOpenIcon />
            </EmptyMedia>
            <EmptyTitle>{t('rooms.rooms.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('rooms.rooms.empty')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('rooms.table.room')}</TableHead>
              <TableHead>{t('rooms.table.track')}</TableHead>
              <TableHead className="w-20">{t('rooms.table.singers')}</TableHead>
              <TableHead className="w-20">{t('rooms.table.ready')}</TableHead>
              <TableHead className="w-24 text-right">
                <span className="sr-only">{t('rooms.table.action')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rooms.map((room) => {
              const full = room.members >= room.capacity;

              return (
                <TableRow key={room.id}>
                  <TableCell>
                    <span className="block truncate font-medium">{room.name}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {t('rooms.table.hostedBy', { host: room.hostName })}
                      {room.locked ? ` · ${t('rooms.table.locked')}` : ''}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-0 truncate text-muted-foreground">
                    {titleFor(room)}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {room.members}/{room.capacity}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{room.ready}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant={full ? 'secondary' : 'outline'}
                      size="sm"
                      disabled={full || joiningId === room.id}
                      onClick={() => {
                        if (room.locked) {
                          setJoinTarget(room);
                          return;
                        }
                        void joinOpenRoom(room);
                      }}
                    >
                      {full ? t('rooms.deny.full') : t('rooms.rooms.join')}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <CreateRoomDialog
        node={node}
        open={createOpen}
        singerName={singerName}
        onOpenChange={onCreatedOpenChange}
        onJoined={onJoined}
      />

      <JoinRoomDialog
        node={node}
        room={joinTarget}
        singerName={singerName}
        onClose={() => setJoinTarget(null)}
        onJoined={onJoined}
      />
    </div>
  );
}
