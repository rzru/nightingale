import type { QueuedStatus } from '@/types/QueuedStatus';
import type { Song } from '@/types/Song';

export type SongItemProps = {
  song: Song;
  queueStatus?: QueuedStatus;
  index: number;
  isFocused: boolean;
  isSelected: boolean;
  onSelect: (song: Song) => void;
};

export type SongListActions = {
  addingToQueue: boolean;
  onAddToQueue: (song: Song, position: 'top' | 'bottom') => void;
  onAnalyze: (song: Song) => void;
  onPlay: (song: Song) => void;
  onPlayMultiplayer: (song: Song) => void;
  onProvideLyrics: (song: Song) => void;
};
