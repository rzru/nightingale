import {
  AlignLeftIcon,
  AudioLinesIcon,
  ImageIcon,
  LanguagesIcon,
  MicIcon,
  PackageIcon,
  PencilLineIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  Trash2Icon,
  XCircleIcon,
} from 'lucide-react';

import type { Song } from '@/types/Song';

import type { SongStatusInfo } from '../song/song-status';
import type { ActionItemProps } from './action-item';

/**
 * Export/view capabilities that depend on whether a song is a sealed `.nge`
 * bundle. Kept out of `buildActionGroups` so its branching doesn't inflate that
 * function's complexity. Export is for analyzed, local, non-`.nge` songs; the
 * read-only lyrics view is for ready `.nge` bundles (normal songs edit lyrics
 * through the analysis actions instead).
 */
function bundleActionCaps(
  song: Song,
  status: SongStatusInfo,
): { canExport: boolean; canViewLyrics: boolean } {
  const isNge = song.path.toLowerCase().endsWith('.nge');
  const ready = status.isReady === true;
  return {
    canExport: ready && song.origin.kind === 'local_file' && !isNge,
    canViewLyrics: ready && isNge,
  };
}

type AnalysisHandler = (fileHash: string) => void | Promise<void>;

type AnalysisHandlers = {
  enqueueOne: AnalysisHandler;
  cancelAnalysisOne: AnalysisHandler;
  deleteSongCache: AnalysisHandler;
  reanalyzeFull: AnalysisHandler;
  reanalyzeTranscript: AnalysisHandler;
  realign: AnalysisHandler;
  reanalyzeForceTranscribe: AnalysisHandler;
  refreshMetadata: (fileHash: string) => Promise<boolean | undefined>;
};

type BuildActionGroupsParams = {
  song: Song;
  status: SongStatusInfo;
  analysisBusy: boolean;
  supportsAnalysisActions: boolean;
  analysis: AnalysisHandlers;
  onEditLyrics: () => void;
  onChangeLanguage: () => void;
  onExport: () => void;
  onViewLyrics: () => void;
  run: (
    message: string,
    action: () => void | boolean | undefined | Promise<void | boolean | undefined>,
    onFalse?: string,
  ) => () => Promise<void>;
};

export function buildActionGroups({
  song,
  status,
  analysisBusy,
  supportsAnalysisActions,
  analysis,
  onEditLyrics,
  onChangeLanguage,
  onExport,
  onViewLyrics,
  run,
}: BuildActionGroupsParams): ActionItemProps[][] {
  const groups: ActionItemProps[][] = [];

  const supportsProvideLyrics = song.transcript_source !== 'Usdx';
  const { canExport, canViewLyrics } = bundleActionCaps(song, status);

  if (status.isReady !== true) {
    const notReadyGroup: ActionItemProps[] = [
      analysisBusy
        ? {
            icon: XCircleIcon,
            title: 'Cancel analysis',
            description: 'Stop analysis and remove this song from the queue.',
            destructive: true,
            onClick: run(`Cancelled analysis for "${song.title}"`, () =>
              analysis.cancelAnalysisOne(song.file_hash),
            ),
          }
        : {
            icon: AudioLinesIcon,
            title: 'Analyze song',
            description: 'Prepare lyrics, timing, key, tempo, and stems.',
            onClick: () => analysis.enqueueOne(song.file_hash),
          },
    ];

    if (supportsProvideLyrics) {
      notReadyGroup.push({
        icon: PencilLineIcon,
        title: 'Provide lyrics',
        description: 'Paste timed LRC, or lyrics to align.',
        disabled: analysisBusy,
        onClick: onEditLyrics,
      });
    }

    groups.push(notReadyGroup);
  }

  // A `.nge` is sealed (no in-place editing), but its lyrics are always
  // viewable. Normal songs edit lyrics via the analysis actions below instead.
  if (canViewLyrics) {
    groups.push([
      {
        icon: ScrollTextIcon,
        title: 'View lyrics',
        description: 'Show the lyrics for this song (read-only).',
        onClick: onViewLyrics,
      },
    ]);
  }

  if (supportsAnalysisActions) {
    // LRC-provided songs have no AI-generated stems/timing to rebuild, so the
    // realign/refetch/transcribe actions don't apply. Offer editing the LRC and
    // an explicit opt-in to replace it with full AI analysis instead.
    if (song.transcript_source === 'Lrc') {
      groups.push([
        {
          icon: PencilLineIcon,
          title: 'Edit lyrics (LRC)',
          description: 'Replace or re-time the provided LRC.',
          onClick: onEditLyrics,
        },
        {
          icon: AudioLinesIcon,
          title: 'Analyze with AI',
          description: 'Replace the LRC with AI stems, lyrics, timing, and key.',
          onClick: run(`Analyzing "${song.title}" with AI`, () =>
            analysis.reanalyzeFull(song.file_hash),
          ),
        },
      ]);
    } else {
      groups.push([
        {
          icon: AlignLeftIcon,
          title: 'Realign',
          description: 'Rebuild timing from the current lyrics.',
          onClick: run(`Realigning "${song.title}"`, () => analysis.realign(song.file_hash)),
        },
        {
          icon: RefreshCwIcon,
          title: 'Refetch lyrics & align',
          description: 'Fetch fresh lyrics, then rebuild timing.',
          onClick: run(`Refetching lyrics & aligning "${song.title}"`, () =>
            analysis.reanalyzeTranscript(song.file_hash),
          ),
        },
        {
          icon: MicIcon,
          title: 'Force transcribe',
          description: 'Ignore online lyrics and transcribe the vocals.',
          onClick: run(`Force transcribing "${song.title}"`, () =>
            analysis.reanalyzeForceTranscribe(song.file_hash),
          ),
        },
        {
          icon: AudioLinesIcon,
          title: 'Full reanalysis',
          description: 'Recreate stems, lyrics, timing, key, and tempo.',
          onClick: run(`Full reanalysis (w/ stems) for "${song.title}"`, () =>
            analysis.reanalyzeFull(song.file_hash),
          ),
        },
      ]);

      groups.push([
        {
          icon: PencilLineIcon,
          title: 'Edit lyrics',
          description: 'Correct the words and rebuild their timing.',
          onClick: onEditLyrics,
        },
        {
          icon: LanguagesIcon,
          title: 'Change language',
          description: 'Set the language and choose how to reprocess.',
          onClick: onChangeLanguage,
        },
      ]);
    }

    if (!song.usdx) {
      groups.push([
        {
          icon: ImageIcon,
          title: 'Refresh metadata',
          description:
            'Reload title, artist, album, duration, and cover art from the library source.',
          onClick: run(
            `Refreshed metadata for "${song.title}"`,
            () => analysis.refreshMetadata(song.file_hash),
            `Nothing to refresh for "${song.title}"`,
          ),
        },
      ]);
    }

    groups.push([
      {
        icon: Trash2Icon,
        title: 'Delete cache',
        description: 'Remove every generated file for this song.',
        destructive: true,
        onClick: run(`Cache deleted for "${song.title}"`, () =>
          analysis.deleteSongCache(song.file_hash),
        ),
      },
    ]);
  }

  if (canExport) {
    groups.push([
      {
        icon: PackageIcon,
        title: 'Export (.nge)',
        description: 'Save a shareable bundle of this song.',
        onClick: onExport,
      },
    ]);
  }

  return groups;
}
