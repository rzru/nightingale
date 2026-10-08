import { atom, useAtom } from 'jotai';

import type { Song } from '@/types/Song';

export type ClearCacheTarget = 'all' | 'videos' | 'models';

export type DialogMode =
  | 'exit'
  | 'create-profile'
  | 'select-profile'
  | 'leaderboards'
  | 'about'
  | 'update'
  | 'donate'
  | 'clear-playback-queue'
  | 'folder-source-confirm'
  | 'jellyfin-connect'
  | 'navidrome-connect'
  | 'plex-connect'
  | { mode: 'language'; song: Song }
  | { mode: 'edit-lyrics'; song: Song }
  | { mode: 'view-lyrics'; song: Song }
  | { mode: 'song-leaderboard'; song: Song }
  | { mode: 'clear-cache'; target: ClearCacheTarget }
  | null;

const dialogAtom = atom<DialogMode>(null);

export const useDialog = () => {
  const [mode, setMode] = useAtom(dialogAtom);

  return {
    mode,
    setMode,
    close: () => setMode(null),
  };
};
