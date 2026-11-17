import type { ProfileStore } from '@/types/ProfileStore';

import { invoke } from './runtime';

export const loadProfiles = async (): Promise<ProfileStore> => {
  return await invoke<ProfileStore>('load_profiles');
};

export const createProfile = async (name: string): Promise<void> => {
  return await invoke<void>('create_profile', { name });
};

export const switchProfile = async (name: string): Promise<void> => {
  return await invoke<void>('switch_profile', { name });
};

export const deleteProfile = async (name: string): Promise<void> => {
  return await invoke<void>('delete_profile', { name });
};

export type AddScoreInput = {
  songHash: string;
  score: number;
  profile?: string;
  /** Scoring system that produced the score; see `ScoreRecord.version`. */
  version: number;
  difficulty: string | null;
};

export const addScore = async (input: AddScoreInput): Promise<void> => {
  return await invoke<void>('add_score', input);
};
