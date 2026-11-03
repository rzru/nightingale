import { FLAVORS, type VideoFlavor } from '@/features/playback/lib/video-flavor';
import { t } from '@/i18n';
import type { BackgroundSelection } from '@/types/BackgroundSelection';
import type { CustomBackground } from '@/types/CustomBackground';

import { shaders } from './shaders';

export const PITCH_GUIDE_SHADER_ID = 'pitch-guide';

export type PlaybackTheme =
  | { kind: 'shader'; id: string; name: string; shaderIndex: number }
  | { kind: 'pixabay' }
  | { kind: 'source' }
  | { kind: 'custom'; background: CustomBackground };

export type BuiltInBackgroundOption = {
  selection: BackgroundSelection;
  label: string;
};

function unreachable(value: never): never {
  throw new Error(`Unknown background variant: ${JSON.stringify(value)}`);
}

export const BUILT_IN_BACKGROUND_OPTIONS: BuiltInBackgroundOption[] = [
  ...shaders.map((shader) => ({
    selection: { kind: 'built_in_shader' as const, id: shader.id },
    label: shader.name,
  })),
  { selection: { kind: 'pixabay' }, label: 'playback.theme.pixabayVideo' },
];

export function themeKey(theme: PlaybackTheme): string {
  switch (theme.kind) {
    case 'shader':
      return `shader:${theme.id}`;
    case 'pixabay':
      return 'pixabay';
    case 'source':
      return 'source';
    case 'custom':
      return `custom:${theme.background.id}`;
    default:
      return unreachable(theme);
  }
}

export function selectionKey(selection: BackgroundSelection): string {
  switch (selection.kind) {
    case 'built_in_shader':
      return `shader:${selection.id}`;
    case 'pixabay':
      return 'pixabay';
    case 'custom':
      return `custom:${selection.id}`;
    default:
      return unreachable(selection);
  }
}

export function createPlaybackThemes(
  customBackgrounds: readonly CustomBackground[],
  hasSourceVideo: boolean,
): PlaybackTheme[] {
  return [
    ...shaders.map<PlaybackTheme>((shader, shaderIndex) => ({
      kind: 'shader',
      id: shader.id,
      name: shader.name,
      shaderIndex,
    })),
    { kind: 'pixabay' },
    ...(hasSourceVideo ? ([{ kind: 'source' }] satisfies PlaybackTheme[]) : []),
    ...customBackgrounds.map<PlaybackTheme>((background) => ({ kind: 'custom', background })),
  ];
}

export function initialThemeKey(input: {
  themes: readonly PlaybackTheme[];
  hasSourceVideo: boolean;
  selection: BackgroundSelection | null | undefined;
  legacyIndex: number;
}): string {
  if (input.hasSourceVideo) {
    return 'source';
  }
  if (input.selection !== null && input.selection !== undefined) {
    const selected = selectionKey(input.selection);
    if (input.themes.some((theme) => themeKey(theme) === selected)) {
      return selected;
    }
  }
  const pitchGuideIndex = shaders.findIndex((shader) => shader.id === PITCH_GUIDE_SHADER_ID);
  const legacyIndex =
    input.legacyIndex >= pitchGuideIndex ? input.legacyIndex + 1 : input.legacyIndex;
  if (legacyIndex >= 0 && legacyIndex < input.themes.length) {
    const legacy = input.themes[legacyIndex];
    if (legacy.kind !== 'source') {
      return themeKey(legacy);
    }
  }
  return themeKey(input.themes[0]);
}

export function selectionForTheme(theme: PlaybackTheme): BackgroundSelection | null {
  switch (theme.kind) {
    case 'shader':
      return { kind: 'built_in_shader', id: theme.id };
    case 'pixabay':
      return { kind: 'pixabay' };
    case 'custom':
      return { kind: 'custom', id: theme.background.id };
    case 'source':
      return null;
    default:
      return unreachable(theme);
  }
}

export function themeName(theme: PlaybackTheme, videoFlavor: VideoFlavor): string {
  switch (theme.kind) {
    case 'source':
      return t('playback.theme.sourceVideo');
    case 'pixabay':
      return t('playback.theme.videoFlavor', {
        flavor: videoFlavor.charAt(0).toUpperCase() + videoFlavor.slice(1),
      });
    case 'shader':
      return theme.name;
    case 'custom':
      return theme.background.name;
    default:
      return unreachable(theme);
  }
}

export function nextThemeKey(themes: readonly PlaybackTheme[], current: string): string {
  const currentIndex = themes.findIndex((theme) => themeKey(theme) === current);
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % themes.length;
  return themeKey(themes[nextIndex]);
}

export function nextFlavorIndex(current: number): number {
  return (current + 1) % FLAVORS.length;
}

export function isPixabayTheme(theme: PlaybackTheme): boolean {
  return theme.kind === 'pixabay';
}

export function isPitchGuideTheme(theme: PlaybackTheme): boolean {
  return theme.kind === 'shader' && theme.id === PITCH_GUIDE_SHADER_ID;
}
