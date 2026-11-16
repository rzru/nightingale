import { open } from '@tauri-apps/plugin-dialog';
import { z } from 'zod';

import { t } from '@/i18n';
import type { AppConfig } from '@/types/AppConfig';

import { createChannel, invoke, isTauri } from './runtime';
import { selectFolderPath } from './source';
import { prepareExportBackground } from './video-export-background';

export const supportsVideoExport = isTauri;

export type VideoStyle = {
  width: number;
  height: number;
  font: string;
  fontSize: number;
  textColor: string;
  highlightColor: string;
  position: number;
  guideVolume: number;
  countdownSeconds: number;
  lyricsOffsetSeconds: number;
};

const progressSchema = z.object({
  percent: z.number().int().min(0).max(100),
  elapsedSeconds: z.number().nonnegative(),
});
export type VideoProgress = z.infer<typeof progressSchema>;

export const chooseVideoBackground = async (): Promise<string | undefined> => {
  const path = await open({
    multiple: false,
    filters: [
      {
        name: t('videoExport.background'),
        extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'mov', 'mkv'],
      },
    ],
  });
  return typeof path === 'string' ? path : undefined;
};

export const exportVideo = async (
  input: { fileHash: string; backgroundPath: string; style: VideoStyle; config: AppConfig },
  callbacks: {
    onProgress: (progress: VideoProgress) => void;
    onPreparing: (percent: number | undefined) => void;
  },
): Promise<string | undefined> => {
  const { fileHash, backgroundPath, style, config } = input;
  const { onProgress, onPreparing } = callbacks;
  const destinationDirectory = await selectFolderPath();
  if (destinationDirectory === undefined) {
    return undefined;
  }
  onPreparing(0);
  const background = await prepareExportBackground(config, backgroundPath, {
    width: style.width,
    height: style.height,
    onProgress: onPreparing,
  });
  onPreparing(undefined);
  const channel = createChannel<unknown>();
  Object.assign(channel, {
    onmessage: (message: unknown) => {
      const progress = progressSchema.safeParse(message);
      if (progress.success) {
        onProgress(progress.data);
      }
    },
  });
  return z.string().parse(
    await invoke('export_song_mp4', {
      options: {
        fileHash,
        ...background,
        destinationDirectory,
        ...style,
      },
      onProgress: channel,
    }),
  );
};
