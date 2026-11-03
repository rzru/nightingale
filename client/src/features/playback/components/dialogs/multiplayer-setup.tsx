import { useAtom } from 'jotai';
import { PlusIcon, UsersIcon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { PlaybackPlayer } from '@/bridge/playback-session';
import { playbackPlayersSchema } from '@/bridge/schemas';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import { useMicDevicesQuery, type MicDevice } from '@/features/microphone/queries/use-mic-devices';
import { multiplayerPlayersAtom } from '@/features/playback/atoms/multiplayer-players';
import { useProfiles } from '@/features/profiles/queries/use-profiles';
import { t } from '@/i18n';
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
import { Field } from '@/shared/components/ui/field';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { useConfig } from '@/shared/config/use-config';
import { useConfigMutation } from '@/shared/config/use-config-mutation';
import {
  PLAYER_COLOR_OPTIONS,
  defaultPlayerColor,
  playerColorOption,
  type PlayerColor,
} from '@/shared/player-colors';
import { cn } from '@/shared/utils/cn';
import type { AppConfig } from '@/types/AppConfig';

const MAX_PLAYERS = 4;
const RING = 'ring-2 ring-primary';
const NO_FOCUS_RING = 'focus-visible:ring-0 focus-visible:border-transparent';
const PROFILE_PREFIX = 'profile:';
const GUEST_VALUE = 'guest';

type MultiplayerSetupDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (players: PlaybackPlayer[]) => void;
  queuePlayback?: boolean;
  submitLabel?: string;
};

const playerNumber = (id: string): number => Number(id.slice('player-'.length));

const profileValue = (profile: string | null): string =>
  profile === null ? GUEST_VALUE : `${PROFILE_PREFIX}${profile}`;

const parseProfile = (value: string): string | null =>
  value.startsWith(PROFILE_PREFIX) ? value.slice(PROFILE_PREFIX.length) : null;

function defaultPlayers(
  activeProfile: string | null,
  microphoneIds: readonly string[],
): PlaybackPlayer[] {
  return [0, 1].map((index) => ({
    id: `player-${index + 1}`,
    profile: index === 0 ? activeProfile : null,
    microphoneId: microphoneIds[index] ?? '',
    color: defaultPlayerColor(index),
  }));
}

type InitialPlayersInput = {
  activeProfile: string | null;
  profiles: readonly string[];
  microphones: readonly MicDevice[];
  preferredMicrophone: string | null;
  rememberedPlayers: readonly PlaybackPlayer[] | null;
};

function orderedMicrophoneIds(
  microphones: readonly MicDevice[],
  preferred: string | null,
): string[] {
  const preferredDevice = microphones.find(
    (microphone) =>
      microphone.deviceId === preferred ||
      microphone.name === preferred ||
      microphone.label === preferred,
  );
  const ids = microphones.map((microphone) => microphone.deviceId);
  if (preferredDevice === undefined) {
    return ids;
  }
  return [preferredDevice.deviceId, ...ids.filter((id) => id !== preferredDevice.deviceId)];
}

function initialPlayers(input: InitialPlayersInput): PlaybackPlayer[] {
  const microphoneIds = orderedMicrophoneIds(input.microphones, input.preferredMicrophone);
  const remembered = input.rememberedPlayers;
  if (remembered === null) {
    return defaultPlayers(input.activeProfile, microphoneIds);
  }

  const availableProfiles = new Set(input.profiles);
  const usedMicrophones = new Set<string>();
  return remembered.map((player, index) => {
    const rememberedMicrophoneAvailable =
      player.microphoneId !== '' && !usedMicrophones.has(player.microphoneId);
    const microphoneId = rememberedMicrophoneAvailable
      ? player.microphoneId
      : (microphoneIds.find((id) => !usedMicrophones.has(id)) ?? '');
    if (microphoneId !== '') {
      usedMicrophones.add(microphoneId);
    }
    return {
      id: `player-${index + 1}`,
      profile:
        player.profile !== null && availableProfiles.has(player.profile) ? player.profile : null,
      microphoneId,
      color: player.color,
    };
  });
}

const setupDataLoading = (...states: boolean[]): boolean => states.some(Boolean);

type SetupErrorInput = {
  microphonesError: boolean;
  microphoneCount: number;
  duplicateMicrophone: boolean;
  duplicateProfile: boolean;
  validMicrophones: boolean;
};

const setupDescription = (queuePlayback: boolean | undefined): string =>
  t(
    queuePlayback === true
      ? 'playback.players.queueSetupDescription'
      : 'playback.players.setupDescription',
  );

const setupSubmitLabel = (label: string | undefined): string =>
  label ?? t('playback.players.startMultiplayer');

const setupNavOpen = (open: boolean, colorDialogOpen: boolean): boolean => open && !colorDialogOpen;

const combineMultiplayerChannels = (config: AppConfig | undefined): boolean =>
  config?.multiplayer_combine_multi_channel ?? true;

const capabilityDevices = (
  combineChannels: boolean,
  microphones: readonly MicDevice[],
  combinedMicrophones: readonly MicDevice[],
): readonly MicDevice[] => (combineChannels ? microphones : combinedMicrophones);

const shouldLoadCombinedCapabilities = (open: boolean, combineChannels: boolean): boolean =>
  open && !combineChannels;

function setupError(input: SetupErrorInput): string | null {
  if (input.microphonesError) {
    return t('playback.players.microphonesError');
  }
  if (input.microphoneCount < 2) {
    return t('playback.players.minimumMicrophonesError');
  }
  if (input.duplicateMicrophone) {
    return t('playback.players.duplicateMicrophoneError');
  }
  if (input.duplicateProfile) {
    return t('playback.players.duplicateProfileError');
  }
  if (!input.validMicrophones) {
    return t('playback.players.missingMicrophoneError');
  }
  return null;
}

type PlayerSetupStatus = {
  selectedMicrophones: Set<string>;
  duplicateProfile: boolean;
  duplicateMicrophone: boolean;
  validMicrophones: boolean;
  canStart: boolean;
};

function playerSetupStatus(
  players: readonly PlaybackPlayer[],
  microphones: readonly MicDevice[],
  loading: boolean,
): PlayerSetupStatus {
  const selectedProfiles = new Set(
    players.flatMap((player) => (player.profile === null ? [] : [player.profile])),
  );
  const selectedMicrophones = new Set(
    players.map((player) => player.microphoneId).filter((id) => id !== ''),
  );
  const duplicateProfile =
    selectedProfiles.size !== players.filter((player) => player.profile !== null).length;
  const validMicrophones = players.every(
    (player) =>
      player.microphoneId !== '' &&
      microphones.some((microphone) => microphone.deviceId === player.microphoneId),
  );
  const duplicateMicrophone = selectedMicrophones.size !== players.length;
  const canStart =
    players.length >= 2 &&
    !loading &&
    !duplicateProfile &&
    !duplicateMicrophone &&
    validMicrophones;
  return {
    selectedMicrophones,
    duplicateProfile,
    duplicateMicrophone,
    validMicrophones,
    canStart,
  };
}

const setupStops = (
  players: readonly PlaybackPlayer[],
  canAdd: boolean,
  canStart: boolean,
  hasMultiChannelInput: boolean,
) => [
  ...(hasMultiChannelInput ? [1] : []),
  ...players.map((_, index) => (index >= 2 ? 4 : 3)),
  ...(canAdd ? [1] : []),
  canStart ? 2 : 1,
];

type PlayerRowsProps = {
  players: PlaybackPlayer[];
  profiles: readonly string[];
  microphones: readonly MicDevice[];
  updatePlayer: (id: string, patch: Partial<PlaybackPlayer>) => void;
  removePlayer: (id: string) => void;
  segmentOffset: number;
  openColorDialog: (id: string) => void;
  navClass: (segment: number, slot?: number) => string;
  focusSegment: (segment: number, slot?: number) => void;
};

const playerNavSlots = (index: number) =>
  index >= 2
    ? { color: 0, remove: 1, profile: 2, microphone: 3 }
    : { color: 0, profile: 1, microphone: 2 };

function updatedPlayers(
  players: readonly PlaybackPlayer[],
  id: string,
  patch: Partial<PlaybackPlayer>,
): PlaybackPlayer[] {
  const key = patch.microphoneId !== undefined ? 'microphoneId' : 'profile';
  const player = players.find((candidate) => candidate.id === id);
  if (player === undefined || patch[key] === undefined || patch[key] === null) {
    return players.map((candidate) =>
      candidate.id === id ? { ...candidate, ...patch } : candidate,
    );
  }
  return players.map((candidate) => {
    if (candidate.id === id) {
      return { ...candidate, ...patch };
    }
    return candidate[key] === patch[key] ? { ...candidate, [key]: player[key] } : candidate;
  });
}

function PlayerRows({
  players,
  profiles,
  microphones,
  updatePlayer,
  removePlayer,
  segmentOffset,
  openColorDialog,
  navClass,
  focusSegment,
}: PlayerRowsProps) {
  return players.map((player, index) => {
    const slots = playerNavSlots(index);
    const segment = index + segmentOffset;
    return (
      <div
        key={player.id}
        className="grid gap-3 px-1 py-3 sm:grid-cols-[7rem_minmax(0,0.8fr)_minmax(0,1.2fr)] sm:items-end"
      >
        <div className="flex h-7 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn('rounded-full', navClass(segment, slots.color))}
            onFocus={() => focusSegment(segment, slots.color)}
            onMouseEnter={() => focusSegment(segment, slots.color)}
            onClick={() => openColorDialog(player.id)}
            aria-label={t('playback.players.chooseColorLabel', { number: index + 1 })}
          >
            <span
              className={`size-2.5 rounded-full ${playerColorOption(player.color).className}`}
            />
          </Button>
          <h3 className="text-sm font-semibold">
            {t('playback.dialogs.multiplayerSetup.playerValue1', { value1: index + 1 })}
          </h3>
          {index >= 2 ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={navClass(segment, slots.remove)}
              onFocus={() => focusSegment(segment, slots.remove)}
              onMouseEnter={() => focusSegment(segment, slots.remove)}
              onClick={() => removePlayer(player.id)}
              aria-label={t('playback.players.removeLabel', { number: index + 1 })}
            >
              <XIcon />
            </Button>
          ) : null}
        </div>

        <Field className="min-w-0">
          <Label htmlFor={`${player.id}-profile`} className="sm:sr-only">
            {t('playback.dialogs.multiplayerSetup.profile')}
          </Label>
          <Select
            value={profileValue(player.profile)}
            onValueChange={(value) => updatePlayer(player.id, { profile: parseProfile(value) })}
          >
            <SelectTrigger
              id={`${player.id}-profile`}
              className={cn(
                'w-full min-w-0 overflow-hidden [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate',
                navClass(segment, slots.profile),
              )}
              onFocus={() => focusSegment(segment, slots.profile)}
              onMouseEnter={() => focusSegment(segment, slots.profile)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>{t('playback.dialogs.multiplayerSetup.profile')}</SelectLabel>
                <SelectItem value={GUEST_VALUE}>
                  {t('playback.dialogs.multiplayerSetup.guest')}
                </SelectItem>
                {profiles.map((profile) => (
                  <SelectItem key={profile} value={`${PROFILE_PREFIX}${profile}`}>
                    {profile}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field className="min-w-0">
          <Label htmlFor={`${player.id}-microphone`} className="sm:sr-only">
            {t('playback.dialogs.multiplayerSetup.microphone')}
          </Label>
          <Select
            value={player.microphoneId || undefined}
            onValueChange={(microphoneId) => updatePlayer(player.id, { microphoneId })}
          >
            <SelectTrigger
              id={`${player.id}-microphone`}
              className={cn(
                'w-full min-w-0 overflow-hidden [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate',
                navClass(segment, slots.microphone),
              )}
              onFocus={() => focusSegment(segment, slots.microphone)}
              onMouseEnter={() => focusSegment(segment, slots.microphone)}
            >
              <SelectValue placeholder={t('playback.dialogs.multiplayerSetup.selectMicrophone')} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>{t('playback.dialogs.multiplayerSetup.microphone')}</SelectLabel>
                {microphones.map((microphone) => (
                  <SelectItem key={microphone.deviceId} value={microphone.deviceId}>
                    {microphone.label}
                  </SelectItem>
                ))}
                {player.microphoneId !== '' &&
                  !microphones.some(
                    (microphone) => microphone.deviceId === player.microphoneId,
                  ) && (
                    <SelectItem value={player.microphoneId}>
                      {t('playback.dialogs.multiplayerSetup.selectedMicrophoneValue1', {
                        value1: player.microphoneId,
                      })}
                    </SelectItem>
                  )}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </div>
    );
  });
}

type CombineChannelsFieldProps = {
  available: boolean;
  checked: boolean;
  className: string;
  onFocus: () => void;
  onCheckedChange: (checked: boolean) => void;
};

function CombineChannelsField({
  available,
  checked,
  className,
  onFocus,
  onCheckedChange,
}: CombineChannelsFieldProps) {
  if (!available) {
    return null;
  }

  return (
    <Label className="gap-1.5 text-sm font-normal text-muted-foreground">
      <Checkbox
        checked={checked}
        className={className}
        onFocus={onFocus}
        onMouseEnter={onFocus}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      {t('playback.dialogs.multiplayerSetup.combineMultiChannel')}
    </Label>
  );
}

type PlayerColorDialogProps = {
  player: PlaybackPlayer | undefined;
  onColorChange: (color: PlayerColor) => void;
  onOpenChange: (open: boolean) => void;
};

function PlayerColorDialog({ player, onColorChange, onOpenChange }: PlayerColorDialogProps) {
  const open = player !== undefined;
  const selectedColor = player?.color;
  const containerRef = useRef<HTMLDivElement>(null);
  const { focusedIndex, focusSegment } = useDialogNav({
    open,
    itemCount: PLAYER_COLOR_OPTIONS.length,
    containerRef,
    onBack: () => onOpenChange(false),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent ref={containerRef} showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('playback.dialogs.multiplayerSetup.choosePlayerColor')}</DialogTitle>
          <DialogDescription>
            {t('playback.dialogs.multiplayerSetup.chooseTheColorUsedForDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {PLAYER_COLOR_OPTIONS.map((option, index) => (
            <Button
              key={option.value}
              type="button"
              variant={option.value === selectedColor ? 'default' : 'outline'}
              className={cn('justify-start', NO_FOCUS_RING, focusedIndex === index && RING)}
              onFocus={() => focusSegment(index)}
              onMouseEnter={() => focusSegment(index)}
              onClick={() => onColorChange(option.value)}
            >
              <span className={`size-3 rounded-full ${option.className}`} aria-hidden="true" />
              {t(option.label)}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MultiplayerSetupDialog({
  open,
  onOpenChange,
  onStart,
  queuePlayback,
  submitLabel,
}: MultiplayerSetupDialogProps) {
  const { data: profileStore, isLoading: profilesLoading } = useProfiles();
  const { data: config, isLoading: configLoading } = useConfig();
  const { mutate: saveConfig } = useConfigMutation();
  const combineChannels = combineMultiplayerChannels(config);
  const microphones = useMicDevicesQuery(undefined, open, combineChannels);
  const capabilityQuery = useMicDevicesQuery(
    undefined,
    shouldLoadCombinedCapabilities(open, combineChannels),
    true,
  );
  const hasMultiChannelInput = capabilityDevices(
    combineChannels,
    microphones.data,
    capabilityQuery.data,
  ).some((device) => device.channelCount > 1);
  const [rememberedPlayers, setRememberedPlayers] = useAtom(multiplayerPlayersAtom);
  const [players, setPlayers] = useState<PlaybackPlayer[]>([]);
  const [colorPlayerId, setColorPlayerId] = useState<string | null>(null);
  const initialized = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      initialized.current = false;
      return;
    }
    const loading = setupDataLoading(profilesLoading, configLoading, microphones.isLoading);
    if (initialized.current || loading) {
      return;
    }
    initialized.current = true;
    setPlayers(
      initialPlayers({
        activeProfile: profileStore?.active ?? null,
        profiles: profileStore?.profiles ?? [],
        microphones: microphones.data,
        preferredMicrophone: config?.preferred_mic ?? null,
        rememberedPlayers,
      }),
    );
  }, [
    config?.preferred_mic,
    configLoading,
    microphones.data,
    microphones.isLoading,
    open,
    profileStore?.active,
    profileStore?.profiles,
    profilesLoading,
    rememberedPlayers,
  ]);

  const loading = setupDataLoading(profilesLoading, configLoading, microphones.isLoading);
  const { selectedMicrophones, duplicateProfile, duplicateMicrophone, validMicrophones, canStart } =
    useMemo(
      () => playerSetupStatus(players, microphones.data, loading),
      [loading, microphones.data, players],
    );
  const canAddPlayer = players.length < MAX_PLAYERS;
  const playerSegmentOffset = Number(hasMultiChannelInput);
  const addPlayerSegment = playerSegmentOffset + players.length;
  const footerSegment = addPlayerSegment + (canAddPlayer ? 1 : 0);
  const stops = useMemo(
    () => setupStops(players, canAddPlayer, canStart, hasMultiChannelInput),
    [canAddPlayer, canStart, hasMultiChannelInput, players],
  );
  const closeDialog = () => {
    setColorPlayerId(null);
    onOpenChange(false);
  };
  const colorDialogOpen = colorPlayerId !== null;
  const { isFocused, focusSegment } = useDialogNav({
    open: setupNavOpen(open, colorDialogOpen),
    itemCount: stops.reduce((total, count) => total + count, 0),
    stops,
    containerRef,
    onBack: closeDialog,
  });
  const navClass = (segment: number, slot = 0): string =>
    cn(NO_FOCUS_RING, isFocused(segment, slot) && RING);

  useEffect(() => {
    if (!open || !initialized.current || !playbackPlayersSchema.safeParse(players).success) {
      return;
    }
    if (players === rememberedPlayers) {
      return;
    }
    setRememberedPlayers(players);
    saveConfig({ multiplayer_players: players });
  }, [open, players, rememberedPlayers, saveConfig, setRememberedPlayers]);

  const updatePlayer = (id: string, patch: Partial<PlaybackPlayer>) => {
    setPlayers((current) => updatedPlayers(current, id, patch));
  };

  const addPlayer = () => {
    const usedIds = new Set(players.map((player) => player.id));
    const nextNumber = [1, 2, 3, 4].find((number) => !usedIds.has(`player-${number}`));
    const nextMicrophone = microphones.data.find(
      (microphone) => !selectedMicrophones.has(microphone.deviceId),
    );
    if (nextNumber === undefined) {
      return;
    }
    setPlayers((current) =>
      [
        ...current,
        {
          id: `player-${nextNumber}`,
          profile: null,
          microphoneId: nextMicrophone?.deviceId ?? '',
          color: defaultPlayerColor(nextNumber - 1),
        },
      ].toSorted((left, right) => playerNumber(left.id) - playerNumber(right.id)),
    );
  };

  const removePlayer = (id: string) => {
    setPlayers((current) => current.filter((player) => player.id !== id));
  };

  const error = setupError({
    microphonesError: microphones.isError,
    microphoneCount: microphones.data.length,
    duplicateMicrophone,
    duplicateProfile,
    validMicrophones,
  });

  const startMultiplayer = () => {
    onStart(players);
    closeDialog();
  };
  const selectedColorPlayer = players.find((player) => player.id === colorPlayerId);
  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      closeDialog();
      return;
    }
    onOpenChange(true);
  };
  const changeColor = (color: PlayerColor) => {
    if (selectedColorPlayer !== undefined) {
      updatePlayer(selectedColorPlayer.id, { color });
    }
    setColorPlayerId(null);
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        ref={containerRef}
        showCloseButton={false}
        className="max-h-[min(90vh,46rem)] overflow-y-auto sm:max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UsersIcon className="size-5" />
            {t('playback.dialogs.multiplayerSetup.setUpPlayers')}
          </DialogTitle>
          <DialogDescription>{setupDescription(queuePlayback)}</DialogDescription>
        </DialogHeader>

        <CombineChannelsField
          available={hasMultiChannelInput}
          checked={combineChannels}
          className={navClass(0)}
          onFocus={() => focusSegment(0)}
          onCheckedChange={(multiplayer_combine_multi_channel) =>
            saveConfig({ multiplayer_combine_multi_channel })
          }
        />

        <div>
          <div className="hidden grid-cols-[7rem_minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3 border-b px-1 pb-2 text-xs font-medium text-muted-foreground sm:grid">
            <span>{t('playback.dialogs.multiplayerSetup.player')}</span>
            <span>{t('playback.dialogs.multiplayerSetup.profile')}</span>
            <span>{t('playback.dialogs.multiplayerSetup.microphone')}</span>
          </div>
          <div className="divide-y border-b">
            <PlayerRows
              players={players}
              profiles={profileStore?.profiles ?? []}
              microphones={microphones.data}
              updatePlayer={updatePlayer}
              removePlayer={removePlayer}
              segmentOffset={playerSegmentOffset}
              openColorDialog={setColorPlayerId}
              navClass={navClass}
              focusSegment={focusSegment}
            />
          </div>
          <div className="mt-2 flex min-h-8 items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={canAddPlayer ? navClass(addPlayerSegment) : undefined}
              disabled={!canAddPlayer}
              onFocus={() => focusSegment(addPlayerSegment)}
              onMouseEnter={() => focusSegment(addPlayerSegment)}
              onClick={addPlayer}
            >
              <PlusIcon />
              {t('playback.dialogs.multiplayerSetup.addPlayer')}
            </Button>
            {error !== null ? (
              <p role="alert" className="text-right text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className={navClass(footerSegment, 0)}
            onFocus={() => focusSegment(footerSegment, 0)}
            onMouseEnter={() => focusSegment(footerSegment, 0)}
            onClick={closeDialog}
          >
            {t('common.actions.cancel')}
          </Button>
          <Button
            type="button"
            className={canStart ? navClass(footerSegment, 1) : undefined}
            disabled={!canStart}
            onFocus={() => focusSegment(footerSegment, 1)}
            onMouseEnter={() => focusSegment(footerSegment, 1)}
            onClick={startMultiplayer}
          >
            {setupSubmitLabel(submitLabel)}
          </Button>
        </DialogFooter>
      </DialogContent>
      <PlayerColorDialog
        player={selectedColorPlayer}
        onColorChange={changeColor}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setColorPlayerId(null);
          }
        }}
      />
    </Dialog>
  );
}
