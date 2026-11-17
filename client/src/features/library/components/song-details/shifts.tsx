import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { setLyricsOffset } from '@/bridge/analysis';
import { useSongRange } from '@/features/library/queries/use-song-range';
import { formatPitchRange } from '@/features/library/utils/pitch-range';
import { calculateKeyShift } from '@/features/library/utils/shift-key';
import { t } from '@/i18n';
import { SCORE_NOTES, SONG_RANGE } from '@/shared/query-keys';
import type { Song } from '@/types/Song';

import { Stepper } from './stepper';

type Props = {
  song: Song;
  tempo: number;
  keyOffset: number;
  disabled?: boolean;
  onTempoChange: (tempo: number) => void;
  onKeyOffsetChange: (keyOffset: number) => void;
};

type ShiftControl = {
  shiftType: 'tempo' | 'key' | 'offset';
  title: string;
  description: string;
  value: string | null;
  onPlus: () => void;
  onMinus: () => void;
  disabled: { plus: boolean; minus: boolean };
};

const hasDetectedKey = (song: Song): song is Song & { key: string } =>
  typeof song.key === 'string' && song.key !== '';

const ShiftControlRow = ({ control, disabled }: { control: ShiftControl; disabled: boolean }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
    <div className="min-w-0 basis-48 flex-1">
      <p className="text-xs font-medium">{control.title}</p>
      <p className="mt-0.5 text-[0.625rem] leading-snug text-muted-foreground">
        {control.description}
      </p>
    </div>
    <Stepper
      ariaLabel={control.title.toLowerCase()}
      label={control.value}
      onClick={{ plus: control.onPlus, minus: control.onMinus }}
      disabled={{
        plus: disabled || control.disabled.plus,
        minus: disabled || control.disabled.minus,
      }}
    />
  </div>
);

const VocalRangeRow = ({ song, keyOffset }: { song: Song; keyOffset: number }) => {
  const { data: info } = useSongRange(song.file_hash);
  // The stored range already includes the saved key shift; follow the stepper
  // while a new shift is pending.
  const range = formatPitchRange(info?.range ?? null, keyOffset - song.key_offset);
  if (range === null) {
    return null;
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <p className="text-xs font-medium">{t('library.songDetails.shifts.vocalRange')}</p>
      <p className="text-xs text-muted-foreground tabular-nums">{range}</p>
    </div>
  );
};

/** Shown when many words of the song have a doubtful timing. */
const LowQualityNote = ({ song }: { song: Song }) => {
  const { data: info } = useSongRange(song.file_hash);
  if (info?.lowQuality !== true) {
    return null;
  }
  return (
    <p className="py-2 text-xs leading-snug text-amber-600 dark:text-amber-400">
      {t('library.songDetails.shifts.lowQualityWarning')}
    </p>
  );
};

const LYRICS_OFFSET_STEP_MS = 50;
const LYRICS_OFFSET_MAX_MS = 5000;

const formatOffset = (offsetMs: number): string =>
  t('library.songDetails.shifts.lyricsOffsetValue', {
    value: `${offsetMs > 0 ? '+' : ''}${offsetMs}`,
  });

/** Per-song lyrics offset: for text that runs early or late against the music. */
const LyricsOffsetRow = ({ song, disabled }: { song: Song; disabled: boolean }) => {
  const queryClient = useQueryClient();
  const { data: info } = useSongRange(song.file_hash);
  const [pending, setPending] = useState(false);
  const offsetMs = info?.lyricsOffsetMs ?? 0;

  const change = (next: number) => {
    setPending(true);
    void setLyricsOffset(song.file_hash, next)
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setPending(false);
        void queryClient.invalidateQueries({ queryKey: SONG_RANGE });
        void queryClient.invalidateQueries({ queryKey: SCORE_NOTES });
      });
  };

  return (
    <ShiftControlRow
      disabled={disabled || pending}
      control={{
        shiftType: 'offset',
        title: t('library.songDetails.shifts.lyricsOffset'),
        description: t('library.songDetails.shifts.lyricsOffsetDescription'),
        value: formatOffset(offsetMs),
        onPlus: () => change(offsetMs + LYRICS_OFFSET_STEP_MS),
        onMinus: () => change(offsetMs - LYRICS_OFFSET_STEP_MS),
        disabled: {
          plus: offsetMs >= LYRICS_OFFSET_MAX_MS,
          minus: offsetMs <= -LYRICS_OFFSET_MAX_MS,
        },
      }}
    />
  );
};

export const Shifts = ({
  song,
  tempo,
  keyOffset,
  disabled = false,
  onTempoChange,
  onKeyOffsetChange,
}: Props) => {
  if (!song.is_analyzed || song.transcript_source === 'Usdx') {
    return null;
  }

  const hasKey = hasDetectedKey(song);
  const shiftedKey = hasKey ? calculateKeyShift(song.key, keyOffset).key : null;
  const controls: ShiftControl[] = [
    {
      shiftType: 'tempo',
      title: t('library.songDetails.shifts.tempo'),
      description: t('library.songDetails.shifts.adjustPlaybackSpeedIn01Steps'),
      value: `${tempo.toFixed(1)}×`,
      onPlus: () => onTempoChange(Number((tempo + 0.1).toFixed(1))),
      onMinus: () => onTempoChange(Number((tempo - 0.1).toFixed(1))),
      disabled: { plus: tempo >= 2, minus: tempo <= 0.5 },
    },
    {
      shiftType: 'key',
      title: t('library.songDetails.shifts.key'),
      description: hasKey
        ? t('library.songDetails.shifts.originalKey', { key: song.key })
        : t('library.songDetails.shifts.analyzeToDetectKey'),
      value: shiftedKey,
      onPlus: () => onKeyOffsetChange(keyOffset + 1),
      onMinus: () => onKeyOffsetChange(keyOffset - 1),
      disabled: {
        plus: keyOffset >= 5 || !hasKey,
        minus: keyOffset <= -5 || !hasKey,
      },
    },
  ];

  return (
    <div className="divide-y">
      <LowQualityNote song={song} />
      <VocalRangeRow song={song} keyOffset={keyOffset} />
      {controls.map((control) => (
        <ShiftControlRow key={control.shiftType} control={control} disabled={disabled} />
      ))}
      <LyricsOffsetRow song={song} disabled={disabled} />
    </div>
  );
};
