import { open } from '@tauri-apps/plugin-dialog';
import { z } from 'zod';

import { t } from '@/i18n';

import { createChannel, invoke, isTauri } from './runtime';
import { selectFolderPath } from './source';

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
  fileHash: string,
  backgroundPath: string,
  style: VideoStyle,
  onProgress: (progress: VideoProgress) => void,
): Promise<string | undefined> => {
  const destinationDirectory = await selectFolderPath();
  if (destinationDirectory === undefined) {
    return undefined;
  }
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
        backgroundPath,
        destinationDirectory,
        ...style,
      },
      onProgress: channel,
    }),
  );
};
