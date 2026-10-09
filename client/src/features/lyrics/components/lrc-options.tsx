import type { TimingChoice } from '@/features/lyrics/lib/timing-choice';
import type { LrcLevel } from '@/features/lyrics/utils/edit-lyrics';
import { cn } from '@/shared/utils/cn';

import { ringFor } from './parts';

type RadioOption<T extends string> = {
  value: T;
  title: string;
  description: string;
};

type RadioRowProps<T extends string> = {
  label: string;
  value: T;
  options: RadioOption<T>[];
  disabled: boolean;
  onSelect: (value: T) => void;
  focusedSlot?: number | null;
  onFocusSlot?: (slot: number) => void;
};

function RadioRow<T extends string>({
  label,
  value,
  options,
  disabled,
  onSelect,
  focusedSlot,
  onFocusSlot,
}: RadioRowProps<T>) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="w-12 pt-1.5 text-xs text-muted-foreground">{label}</span>
      <fieldset className="flex flex-wrap gap-1">
        <legend className="sr-only">{label}</legend>
        {options.map((option, index) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onSelect(option.value)}
              onMouseEnter={disabled ? undefined : () => onFocusSlot?.(index)}
              onFocus={disabled ? undefined : () => onFocusSlot?.(index)}
              className={cn(
                'flex items-start gap-2 rounded-md px-2 py-1 text-left transition-colors',
                disabled ? 'cursor-default opacity-45' : 'hover:bg-muted',
                !disabled && ringFor(focusedSlot === index),
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border',
                  selected ? 'border-primary' : 'border-muted-foreground/50',
                )}
              >
                {selected && <span className="size-1.5 rounded-full bg-primary" />}
              </span>
              <span className="flex flex-col leading-tight">
                <span
                  className={cn('text-xs', selected ? 'text-foreground' : 'text-muted-foreground')}
                >
                  {option.title}
                </span>
                <span className="text-[11px] text-muted-foreground">{option.description}</span>
              </span>
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}

type LrcOptionsProps = {
  level: LrcLevel;
  stemsSeparated: boolean;
  timingChoice: TimingChoice;
  onTimingChoiceChange: (choice: TimingChoice) => void;
  separateStems: boolean;
  onSeparateStemsChange: (value: boolean) => void;
  disabled?: boolean;
  timingFocusedSlot?: number | null;
  audioFocusedSlot?: number | null;
  onFocusOption?: (row: 'timing' | 'audio', slot: number) => void;
};

export const LrcOptions = ({
  level,
  stemsSeparated,
  timingChoice,
  onTimingChoiceChange,
  separateStems,
  onSeparateStemsChange,
  disabled,
  timingFocusedSlot,
  audioFocusedSlot,
  onFocusOption,
}: LrcOptionsProps) => {
  const hasLrc = level !== 'none';
  const timingDisabled = disabled === true || !hasLrc;
  const displayTiming: TimingChoice = hasLrc ? timingChoice : 'align';
  const useProvided = displayTiming === 'provided';
  // Only lock the audio choice when the track already has separated stems (that
  // mode is fixed) or when running alignment (which requires stems). An LRC
  // track played over the original mix stays editable so it doesn't wrongly
  // default to "Separate stems".
  const audioDisabled = disabled === true || stemsSeparated || !useProvided;
  const displayAudio: 'separate' | 'skip' =
    stemsSeparated || !useProvided || separateStems ? 'separate' : 'skip';

  return (
    <div className="mt-3 flex flex-col divide-y divide-border">
      <RadioRow<TimingChoice>
        label="Timing"
        value={displayTiming}
        disabled={timingDisabled}
        onSelect={onTimingChoiceChange}
        focusedSlot={timingFocusedSlot}
        onFocusSlot={(slot) => onFocusOption?.('timing', slot)}
        options={[
          { value: 'provided', title: 'Use provided', description: 'Instant · no transcription' },
          { value: 'anchored', title: 'Align words', description: 'Keeps line timing · runs AI' },
          { value: 'align', title: 'Run alignment', description: 'Ignores timing · runs AI' },
        ]}
      />

      <RadioRow<'separate' | 'skip'>
        label="Audio"
        value={displayAudio}
        disabled={audioDisabled}
        onSelect={(value) => onSeparateStemsChange(value === 'separate')}
        focusedSlot={audioFocusedSlot}
        onFocusSlot={(slot) => onFocusOption?.('audio', slot)}
        options={[
          { value: 'skip', title: 'Play original', description: 'No separation · detects key' },
          { value: 'separate', title: 'Separate stems', description: 'Runs AI · takes a while' },
        ]}
      />
    </div>
  );
};
