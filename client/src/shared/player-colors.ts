import type { TranslationKey } from '@/i18n';

export const PLAYER_COLOR_VALUES = ['rose', 'fuchsia', 'amber', 'emerald'] as const;

export type PlayerColor = (typeof PLAYER_COLOR_VALUES)[number];

export type PlayerColorOption = {
  value: PlayerColor;
  label: TranslationKey;
  className: string;
  rgb: { r: number; g: number; b: number };
};

export const PLAYER_COLOR_OPTIONS: readonly PlayerColorOption[] = [
  {
    value: 'rose',
    label: 'shared.playerColors.rose',
    className: 'bg-rose-400',
    rgb: { r: 0.98, g: 0.44, b: 0.52 },
  },
  {
    value: 'fuchsia',
    label: 'shared.playerColors.fuchsia',
    className: 'bg-fuchsia-400',
    rgb: { r: 0.91, g: 0.36, b: 0.78 },
  },
  {
    value: 'amber',
    label: 'shared.playerColors.amber',
    className: 'bg-amber-400',
    rgb: { r: 0.98, g: 0.66, b: 0.15 },
  },
  {
    value: 'emerald',
    label: 'shared.playerColors.emerald',
    className: 'bg-emerald-400',
    rgb: { r: 0.2, g: 0.83, b: 0.6 },
  },
];

export function playerColorOption(color: PlayerColor): PlayerColorOption {
  return PLAYER_COLOR_OPTIONS.find((option) => option.value === color) ?? PLAYER_COLOR_OPTIONS[0];
}

export function defaultPlayerColor(index: number): PlayerColor {
  return PLAYER_COLOR_OPTIONS[index % PLAYER_COLOR_OPTIONS.length]?.value ?? 'rose';
}
