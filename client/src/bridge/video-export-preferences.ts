import { z } from 'zod';

import type { AppConfig } from '@/types/AppConfig';

import type { VideoStyle } from './video-export';

const storageKey = 'nightingale:video-export:v1';
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const styleSchema = z
  .object({
    width: z.number(),
    height: z.number(),
    font: z.enum(['Arial', 'Verdana', 'Georgia', 'Tahoma']),
    fontSize: z.number().int().min(20).max(120),
    textColor: color,
    highlightColor: color,
    position: z.number().int().min(1).max(9),
    guideVolume: z.number().int().min(0).max(100),
    countdownSeconds: z.number().int().min(0).max(10),
    lyricsOffsetSeconds: z.number().min(-30).max(30),
  })
  .refine((value) =>
    ['1280x720', '1920x1080', '1080x1920'].includes(`${value.width}x${value.height}`),
  );
const preferencesSchema = z.object({ style: styleSchema, background: z.string().max(32768) });

export type VideoExportPreferences = { style: VideoStyle; background: string };

export function readVideoExportPreferences(config: AppConfig): VideoExportPreferences {
  const vertical = config.lyrics_vertical_position;
  const horizontal = config.lyrics_horizontal_position;
  const defaults: VideoExportPreferences = {
    background: '',
    style: {
      width: 1920,
      height: 1080,
      font: 'Arial',
      fontSize: 64,
      textColor: '#ffffff',
      highlightColor: '#ffd700',
      position:
        ({ top: 7, center: 4 }[vertical ?? ''] ?? 1) +
        ({ left: 0, right: 2 }[horizontal ?? ''] ?? 1),
      guideVolume: 0,
      countdownSeconds: 0,
      lyricsOffsetSeconds: 0,
    },
  };
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === null) {
      return defaults;
    }
    const result = preferencesSchema.safeParse(JSON.parse(stored));
    return result.success ? result.data : defaults;
  } catch {
    return defaults;
  }
}

export function saveVideoExportPreferences(preferences: VideoExportPreferences): void {
  const result = preferencesSchema.safeParse(preferences);
  if (result.success) {
    localStorage.setItem(storageKey, JSON.stringify(result.data));
  }
}
