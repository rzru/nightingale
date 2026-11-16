import { z } from 'zod';

import { t } from '@/i18n';
import { recordShader } from '@/shared/visuals/record-shader';
import { composeCustomFragment, shaders } from '@/shared/visuals/shaders';
import type { AppConfig } from '@/types/AppConfig';

import { loadCustomShaderSource } from './backgrounds';
import { fetchPixabayVideos } from './playback';
import { invoke } from './runtime';

export function exportBackgroundSelection(config: AppConfig) {
  if (config.last_background !== null) {
    return config.last_background;
  }
  const legacy = shaders.filter((shader) => shader.id !== 'pitch-guide');
  const index = config.last_theme ?? 0;
  if (index >= legacy.length) {
    return { kind: 'pixabay' as const };
  }
  return { kind: 'built_in_shader' as const, id: (legacy[index] ?? legacy[0]).id };
}

export function exportBackgroundName(config: AppConfig): string {
  const selection = exportBackgroundSelection(config);
  if (selection.kind === 'built_in_shader') {
    return shaders.find((shader) => shader.id === selection.id)?.name ?? shaders[0].name;
  }
  if (selection.kind === 'custom') {
    return (
      config.custom_backgrounds.find((background) => background.id === selection.id)?.name ??
      t('videoExport.appBackground')
    );
  }
  return t('playback.theme.pixabayVideo');
}

export function exportBackgroundIsShader(config: AppConfig): boolean {
  const selection = exportBackgroundSelection(config);
  return (
    selection.kind === 'built_in_shader' ||
    (selection.kind === 'custom' &&
      config.custom_backgrounds.some(
        (item) => item.id === selection.id && item.background_type === 'shader',
      ))
  );
}

type BackgroundInput = {
  backgroundPath: string;
  backgroundData?: number[];
  backgroundExtension?: string;
};

async function encodedBackground(blob: Blob, extension: string): Promise<BackgroundInput> {
  if (blob.size === 0 || blob.size > 32 * 1024 * 1024) {
    throw new Error(t('videoExport.backgroundTooLarge'));
  }
  return {
    backgroundPath: '',
    backgroundData: Array.from(new Uint8Array(await blob.arrayBuffer())),
    backgroundExtension: extension,
  };
}

async function downloadBackground(url: string, type: 'image' | 'video'): Promise<BackgroundInput> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok || response.body === null) {
    throw new Error(t('videoExport.backgroundUnavailable'));
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  const readChunk = async (): Promise<void> => {
    const { done, value } = await reader.read();
    if (done) {
      return;
    }
    length += value.byteLength;
    if (length > 32 * 1024 * 1024) {
      throw new Error(t('videoExport.backgroundTooLarge'));
    }
    chunks.push(new Uint8Array(value));
    return readChunk();
  };
  try {
    await readChunk();
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const blob = new Blob(chunks);
  let extension = 'mp4';
  if (type === 'image') {
    const signature = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    extension = 'png';
    if (signature[0] === 255 && signature[1] === 216) {
      extension = 'jpg';
    } else if (signature[0] === 82 && signature[8] === 87) {
      extension = 'webp';
    }
  }
  return encodedBackground(blob, extension);
}

type AnimationOptions = { width: number; height: number; onProgress: (percent: number) => void };

async function customExportBackground(
  config: AppConfig,
  id: string,
  animation: AnimationOptions,
): Promise<BackgroundInput> {
  const background = config.custom_backgrounds.find((item) => item.id === id);
  if (background === undefined) {
    throw new Error(t('videoExport.backgroundUnavailable'));
  }
  if (background.background_type === 'shader') {
    const fragment = composeCustomFragment(await loadCustomShaderSource(background));
    return encodedBackground(
      await recordShader(fragment, animation.width, animation.height, animation.onProgress),
      'webm',
    );
  }
  if (background.source.kind === 'url') {
    return downloadBackground(background.source.url, background.background_type);
  }
  return {
    backgroundPath: z
      .string()
      .parse(await invoke('resolve_custom_background_path', { id: background.id })),
  };
}

export async function prepareExportBackground(
  config: AppConfig,
  path: string,
  animation: AnimationOptions,
): Promise<BackgroundInput> {
  if (path !== '') {
    return { backgroundPath: path };
  }
  const selection = exportBackgroundSelection(config);
  if (selection.kind === 'built_in_shader') {
    const shader = shaders.find((item) => item.id === selection.id) ?? shaders[0];
    return encodedBackground(
      await recordShader(
        shader.fragmentShader,
        animation.width,
        animation.height,
        animation.onProgress,
      ),
      'webm',
    );
  }
  if (selection.kind === 'custom') {
    return customExportBackground(config, selection.id, animation);
  }
  const flavors = ['nature', 'underwater', 'space', 'city', 'countryside'];
  const paths = await fetchPixabayVideos(flavors[config.last_video_flavor ?? 0] ?? flavors[0]);
  if (paths.length === 0) {
    throw new Error(t('videoExport.backgroundUnavailable'));
  }
  return { backgroundPath: paths[0] };
}
