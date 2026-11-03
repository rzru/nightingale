import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { onShiftKeyDone, onShiftTempoDone, shiftKey, shiftTempo } from '@/bridge/analysis';
import { calculateKeyShift } from '@/features/library/utils/shift-key';
import { t } from '@/i18n';
import { SONGS } from '@/shared/query-keys';
import type { ShiftDone } from '@/types/ShiftDone';
import type { Song } from '@/types/Song';

type ShiftListener = (callback: (payload: ShiftDone) => void) => Promise<() => void>;

async function waitForShift(
  fileHash: string,
  register: ShiftListener,
  invokeShift: () => Promise<void>,
): Promise<ShiftDone> {
  let resolveDone!: (payload: ShiftDone) => void;
  const done = new Promise<ShiftDone>((resolve) => {
    resolveDone = resolve;
  });
  const unlisten = await register((payload) => {
    if (payload.file_hash === fileHash) {
      resolveDone(payload);
    }
  });

  try {
    await invokeShift();
    const payload = await done;
    if (typeof payload.error === 'string' && payload.error !== '') {
      throw new Error(payload.error);
    }
    return payload;
  } finally {
    unlisten();
  }
}

export type PreparePlaybackInput = {
  song: Song;
  tempo: number;
  keyOffset: number;
};

export async function preparePlayback({
  song,
  tempo,
  keyOffset,
}: PreparePlaybackInput): Promise<Song> {
  let preparedSong = song;

  if (keyOffset !== song.key_offset && typeof song.key === 'string' && song.key !== '') {
    const target = calculateKeyShift(song.key, keyOffset);
    const result = await waitForShift(song.file_hash, onShiftKeyDone, () =>
      shiftKey(song.file_hash, target.key, target.pitchRatio, target.keyOffset),
    );
    preparedSong = {
      ...preparedSong,
      override_key: result.key === song.key ? null : result.key,
      key_offset: keyOffset,
      tempo: result.tempo ?? preparedSong.tempo,
    };
  }

  if (tempo !== song.tempo) {
    const result = await waitForShift(song.file_hash, onShiftTempoDone, () =>
      shiftTempo(song.file_hash, tempo),
    );
    preparedSong = {
      ...preparedSong,
      override_key: result.key === song.key ? null : result.key,
      tempo: result.tempo ?? tempo,
    };
  }

  return preparedSong;
}

export const usePreparePlaybackMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: preparePlayback,
    onError: (error: Error) => {
      toast.error(
        t('playback.usePreparePlaybackMutation.couldnTPreparePlayback', { value1: error.message }),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: SONGS });
    },
  });
};
