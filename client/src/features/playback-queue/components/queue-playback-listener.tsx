import { useAtom } from 'jotai';
import { useEffect } from 'react';
import { toast } from 'sonner';

import type { PlaybackPlayer } from '@/bridge/playback-session';
import { onQueuePlaybackRequested, saveRemoteMicrophones } from '@/bridge/playback-status';
import type { QueuePlaybackPlayer } from '@/bridge/schemas';
import { useMicDevices, type MicDevice } from '@/features/microphone/queries/use-mic-devices';
import {
  usePlaybackQueueQuery,
  useStartNextPlaybackQueueSong,
} from '@/features/playback-queue/use-playback-queue';
import { multiplayerPlayersAtom } from '@/features/playback/atoms/multiplayer-players';
import { t } from '@/i18n';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';

/**
 * The phone picks host microphones from the published list, so honor its picks
 * that still exist, then fill any remaining singer from other devices.
 */
function withMicrophones(
  players: readonly QueuePlaybackPlayer[],
  devices: readonly MicDevice[],
  remembered: readonly PlaybackPlayer[] | null,
): PlaybackPlayer[] | null {
  const available = devices.map((device) => device.deviceId);
  const picked = [
    ...players.map((player) => player.microphoneId),
    ...(remembered ?? []).map((player) => player.microphoneId),
  ];
  const microphones: string[] = [];
  for (const id of [...picked, ...available]) {
    if (available.includes(id) && !microphones.includes(id)) {
      microphones.push(id);
    }
  }
  if (microphones.length < players.length) {
    return null;
  }
  return players.map((player, index) => ({ ...player, microphoneId: microphones[index] ?? '' }));
}

/**
 * Starts the queue when a phone asks for it. Lives in the host window because
 * that is the side that owns the playback surface; the phone only requests.
 */
export function QueuePlaybackListener() {
  const { data: entries = [] } = usePlaybackQueueQuery();
  const { playNext } = useStartNextPlaybackQueueSong(entries);
  const [rememberedPlayers] = useAtom(multiplayerPlayersAtom);
  const microphones = useMicDevices();
  const playNextRef = useLatestRef(playNext);
  const lineupRef = useLatestRef({ rememberedPlayers, microphones });

  // The phone's player setup offers these devices, so publish what the host has.
  useEffect(() => {
    void saveRemoteMicrophones(microphones.map(({ deviceId, label }) => ({ deviceId, label })));
  }, [microphones]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void onQueuePlaybackRequested((players) => {
      if (players === null) {
        toast.error(t('playback.players.invalidQueueRequest'));
        return;
      }
      if (players.length === 0) {
        playNextRef.current();
        return;
      }
      const { rememberedPlayers: savedPlayers, microphones: savedMicrophones } = lineupRef.current;
      const lineup = withMicrophones(players, savedMicrophones, savedPlayers);
      if (lineup === null) {
        toast.error(t('playback.players.minimumMicrophonesError'));
        return;
      }
      playNextRef.current(lineup);
    }).then((fn) => {
      if (cancelled) {
        fn();
        return undefined;
      }
      unlisten = fn;
      return undefined;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [lineupRef, playNextRef]);

  return null;
}
