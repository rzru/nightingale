import { AudioLinesIcon, TrophyIcon } from 'lucide-react';
import { Fragment } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import { exportSongNge } from '@/bridge/playback';
import { useAnalysis } from '@/features/library/hooks/use-analysis';
import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useProfiles } from '@/features/profiles/queries/use-profiles';
import { t } from '@/i18n';
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

/** Analyzed songs with an editable transcript: not UltraStar, not a bundle. */
const canEditTiming = (song: Song): boolean =>
  song.is_analyzed &&
  song.transcript_source !== 'Usdx' &&
  !song.path.toLowerCase().endsWith('.nge');

export const ActionsSection = ({
  song,
  status,
  analysisBusy,
  supportsAnalysisActions,
}: ActionsSectionProps) => {
  const { setMode } = useDialog();
  const navigate = useNavigate();
  const analysis = useAnalysis();
  const { data: profiles } = useProfiles();
  const hasScores = profiles?.scores.some((score) => score.song_hash === song.file_hash) ?? false;

  const onExport = async (): Promise<void> => {
    try {
      const result = await exportSongNge(song.file_hash);
      if (result?.delivery === 'filesystem') {
        toast.success(t('library.songActions.exported', { title: song.title }), {
          description: result.path,
        });
      } else if (result !== undefined) {
        toast.success(t('library.songActions.exported', { title: song.title }));
      }
    } catch (error) {
      toast.error(
        t('library.songActions.exportFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
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

  if (canEditTiming(song)) {
    groups.push([
      {
        icon: AudioLinesIcon,
        title: 'timingEditor.open',
        description: 'timingEditor.openDescription',
        onClick: () => {
          const params = new URLSearchParams({
            hash: song.file_hash,
            title: song.title,
            tempo: String(song.tempo),
          });
          void navigate(`/timing-editor?${params.toString()}`);
        },
      },
    ]);
  }

  if (hasScores) {
    groups.unshift([
      {
        icon: TrophyIcon,
        title: 'library.songDetails.actionsSection.leaderboard',
        description: 'library.songDetails.actionsSection.viewTheBestScoreFromEachProfile',
        onClick: () => setMode({ mode: 'song-leaderboard', song }),
      },
    ]);
  }

  return (
    <section className="px-2 py-4" aria-labelledby="song-actions-heading">
      <h3
        id="library.songDetails.actionsSection.songActionsHeading"
        className="mb-2 px-2 text-xs font-semibold"
      >
        {t('common.actions.label')}
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
