import type { ReactNode } from 'react';

import { Button } from '@/shared/components/ui/button';
import { ButtonGroup } from '@/shared/components/ui/button-group';
import { FieldDescription } from '@/shared/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { cn } from '@/shared/utils/cn';

import { NUMBER_PICKER_SIZE, type SettingsOption } from './constants';

type SettingsSelectProps = {
  id?: string;
  label: string;
  placeholder: string;
  value: string;
  options: SettingsOption[];
  disabled?: boolean;
  triggerClassName?: string;
  onValueChange: (value: string) => void;
};

export function SettingsSelect({
  id,
  label,
  placeholder,
  value,
  options,
  disabled = false,
  triggerClassName,
  onValueChange,
}: SettingsSelectProps) {
  return (
    <Select disabled={disabled} onValueChange={onValueChange} value={value}>
      <SelectTrigger id={id} className={cn('w-full', triggerClassName)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" className="w-[var(--radix-select-trigger-width)]">
        <SelectGroup>
          <SelectLabel>{label}</SelectLabel>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} description={option.description}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

type SettingsButtonGroupOption<T> = {
  value: T;
  label: string;
};

type SettingsButtonGroupProps<T> = {
  value: T;
  options: SettingsButtonGroupOption<T>[];
  segment: number;
  getFocusClassName: (segment: number, slot?: number) => string;
  onChange: (value: T) => void;
};

export function SettingsButtonGroup<T>({
  value,
  options,
  segment,
  getFocusClassName,
  onChange,
}: SettingsButtonGroupProps<T>) {
  return (
    <ButtonGroup>
      {options.map((option, index) => (
        <Button
          key={option.label}
          variant={option.value === value ? 'default' : 'outline'}
          onClick={() => onChange(option.value)}
          className={getFocusClassName(segment, index)}
        >
          {option.label}
        </Button>
      ))}
    </ButtonGroup>
  );
}

type NumberButtonGroupProps = {
  name: string;
  value: number;
  segment: number;
  getFocusClassName: (segment: number, slot?: number) => string;
  onChange: (value: number) => void;
};

export function NumberButtonGroup({
  name,
  value,
  segment,
  getFocusClassName,
  onChange,
}: NumberButtonGroupProps) {
  return (
    <ButtonGroup className="scrollbar-hide w-full max-w-full items-center justify-start overflow-x-auto py-1 px-0.5">
      {Array.from({ length: NUMBER_PICKER_SIZE }, (_, index) => {
        const option = index + 1;

        return (
          <Button
            key={`${name}-${option}`}
            onClick={() => onChange(option)}
            variant={value === option ? 'default' : 'outline'}
            className={getFocusClassName(segment, index)}
          >
            {option}
          </Button>
        );
      })}
    </ButtonGroup>
  );
}

export function PageHeader() {
  return (
    <div className="space-y-1">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Settings</h1>
      <p className="text-sm text-muted-foreground">
        Set how Nightingale looks and sounds during playback, and control how it separates vocals,
        transcribes lyrics, and syncs them to the music when analyzing songs.
      </p>
    </div>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <FieldDescription>{children}</FieldDescription>;
}
