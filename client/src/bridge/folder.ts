import { open } from '@tauri-apps/plugin-dialog';

import { isTauri } from './runtime';

type FolderPrompt = {
  message: string;
  defaultPath: string;
};

export const selectFolderPath = async (prompt?: FolderPrompt): Promise<string | undefined> => {
  if (!isTauri) {
    const input = window.prompt(
      prompt?.message ?? 'Songs folder path (visible to the server)',
      prompt?.defaultPath ?? '/songs',
    );

    if (typeof input !== 'string' || input === '') {
      return undefined;
    }

    const trimmed = input.trim();

    return trimmed.length > 0 ? trimmed : undefined;
  }

  const folder = await open({ directory: true, multiple: false });

  return folder ?? undefined;
};
