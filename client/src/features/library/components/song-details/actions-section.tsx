import { TrophyIcon } from 'lucide-react';
import { Fragment } from 'react';
import { toast } from 'sonner';

import { exportSongNge } from '@/bridge/playback';
import { selectFolderPath } from '@/bridge/source';
import { useAnalysis } from '@/features/library/hooks/use-analysis';
import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useProfiles } from '@/features/profiles/queries/use-profiles';
import { Separator } from '@/shared/components/ui/separator';
import type { Song } from '@/types/Song';

import type { SongStatusInfo } from '../song/song-status';
import { ActionItem } from './action-item';
import { buildActionGroups } from './song-actions';

type ActionsSectionProps = {
  song: Song;
  status: SongStatusInfo;
  analysisBusy: boolean;
  supportsAnalysisActions: boolean;
};

const run =
  (
    message: string,
    action: () => void | boolean | undefined | Promise<void | boolean | undefined>,
    onFalse?: string,
  ) =>
  async (): Promise<void> => {
    const result = await action();
    toast.info(
      result === false && typeof onFalse === 'string' && onFalse !== '' ? onFalse : message,
    );
  };

export const ActionsSection = ({
  song,
  status,
  analysisBusy,
  supportsAnalysisActions,
}: ActionsSectionProps) => {
  const { setMode } = useDialog();
  const analysis = useAnalysis();
  const { data: profiles } = useProfiles();
  const hasScores = profiles?.scores.some((score) => score.song_hash === song.file_hash) ?? false;

  const onExport = async (): Promise<void> => {
    const destDir = await selectFolderPath();
    if (destDir === undefined) {
      return;
    }
    try {
      const path = await exportSongNge(song.file_hash, destDir);
      toast.success(`Exported "${song.title}" (${path})`);
    } catch (error) {
      toast.error(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const groups = buildActionGroups({
    song,
    status,
    analysisBusy,
    supportsAnalysisActions,
    analysis,
    onEditLyrics: () => setMode({ mode: 'edit-lyrics', song }),
    onChangeLanguage: () => setMode({ mode: 'language', song }),
    onExport: () => {
      void onExport();
    },
    onViewLyrics: () => setMode({ mode: 'view-lyrics', song }),
    run,
  });

  if (hasScores) {
    groups.unshift([
      {
        icon: TrophyIcon,
        title: 'Leaderboard',
        description: 'View the best score from each profile.',
        onClick: () => setMode({ mode: 'song-leaderboard', song }),
      },
    ]);
  }

  return (
    <section className="px-2 py-4" aria-labelledby="song-actions-heading">
      <h3 id="song-actions-heading" className="mb-2 px-2 text-xs font-semibold">
        Actions
      </h3>
      <div className="flex flex-col gap-1">
        {groups.map((group, groupIndex) => (
          <Fragment key={group.map((item) => item.title).join('|')}>
            {groupIndex > 0 ? <Separator className="my-1" /> : null}
            {group.map((item) => (
              <ActionItem key={item.title} {...item} />
            ))}
          </Fragment>
        ))}
      </div>
    </section>
  );
};
