import { calculateKeyShift } from '@/features/library/utils/shift-key';
import { t } from '@/i18n';
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
  shiftType: 'tempo' | 'key';
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
      {controls.map((control) => (
        <ShiftControlRow key={control.shiftType} control={control} disabled={disabled} />
      ))}
    </div>
  );
};
