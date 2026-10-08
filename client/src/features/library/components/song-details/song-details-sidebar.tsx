import { useQueryClient } from '@tanstack/react-query';
import { ListPlusIcon, PlayIcon, UsersIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { PlaybackPlayer } from '@/bridge/playback-session';
import { useAddPlaybackQueueEntry } from '@/features/playback-queue/use-playback-queue';
import { MultiplayerSetupDialog } from '@/features/playback/components/dialogs/multiplayer-setup';
import { usePlaybackLauncher } from '@/features/playback/hooks/use-playback-launcher';
import { usePreparePlaybackMutation } from '@/features/playback/mutations/use-prepare-playback-mutation';
import { useBestScoresBySongForActiveProfile } from '@/features/profiles/hooks/use-best-scores-by-song';
import { Button } from '@/shared/components/ui/button';
import { Separator } from '@/shared/components/ui/separator';
import { Spinner } from '@/shared/components/ui/spinner';
import { SONGS } from '@/shared/query-keys';
import type { QueuedStatus } from '@/types/QueuedStatus';
import type { Song } from '@/types/Song';

import { getSongStatusInfo } from '../song/song-status';
import { ActionsSection } from './actions-section';
import { KeyTempoSection } from './key-tempo-section';
import { SongDetailsHeader } from './song-details-header';
import { useSongDetailsNav } from './use-song-details-nav';

type SongDetailsSidebarProps = {
  song: Song;
  queueStatus?: QueuedStatus;
  onClose: () => void;
};

/**
 * Which analysis capabilities a song supports. A `.nge` is a sealed,
 * already-analyzed bundle — its artifacts live inside the bundle file, so
 * the mutating actions (reanalyze, realign, edit lyrics, key/tempo shift,
 * refresh metadata) don't apply; playback stays fully available. To edit, the
 * user re-analyzes the original source and exports a fresh bundle.
 */
function deriveAnalysisCaps(
  song: Song,
  isReady: boolean,
  keyPending: boolean,
): { supportsShifts: boolean; supportsAnalysisActions: boolean } {
  if (song.path.toLowerCase().endsWith('.nge')) {
    // A `.nge` is sealed, so analysis actions (reanalyze/realign/edit) stay
    // hidden — but key/tempo shift is a playback transform derived from the
    // sealed stems, so it's offered. Shifting materializes variant stems in the
    // cache (the original bundle is untouched).
    return {
      supportsShifts: song.is_analyzed && song.transcript_source !== 'Usdx' && !keyPending,
      supportsAnalysisActions: false,
    };
  }
  return {
    supportsShifts: song.is_analyzed && song.transcript_source !== 'Usdx' && !keyPending,
    supportsAnalysisActions: isReady && song.transcript_source !== 'Usdx',
  };
}

type AddToQueueButtonProps = {
  song: Song;
  tempo: number;
  keyOffset: number;
  ready: boolean;
  preparing: boolean;
};

function AddToQueueButton({ song, tempo, keyOffset, ready, preparing }: AddToQueueButtonProps) {
  const { mutate: addToQueue, isLoading } = useAddPlaybackQueueEntry();

  return (
    <Button
      variant="outline"
      size="icon-lg"
      disabled={!ready || preparing || isLoading}
      onClick={() => addToQueue({ song, tempo, keyOffset })}
      aria-label={`Add ${song.title} to playback queue`}
      title="Add to queue"
    >
      <ListPlusIcon />
    </Button>
  );
}

export const SongDetailsSidebar = ({ song, queueStatus, onClose }: SongDetailsSidebarProps) => {
  const queryClient = useQueryClient();
  const bestScores = useBestScoresBySongForActiveProfile();
  const { detailsRef, closeDetails } = useSongDetailsNav(onClose);
  const { mutate: preparePlayback, isLoading: preparingPlayback } = usePreparePlaybackMutation();
  const { launch, reserveTarget } = usePlaybackLauncher();
  const [tempo, setTempo] = useState(song.tempo);
  const [keyOffset, setKeyOffset] = useState(song.key_offset);
  const [multiplayerOpen, setMultiplayerOpen] = useState(false);

  const status = getSongStatusInfo(song.is_analyzed, queueStatus);
  const analysisBusy = queueStatus === 'Queued' || Boolean(status.isAnalyzing);
  // LRC songs played over the original mix are playable immediately while their
  // key is still being detected off-queue. Until the key lands, treat the
  // key/tempo section as pending rather than showing controls.
  const keyPending =
    song.is_analyzed && song.transcript_source === 'Lrc' && song.no_stems && song.key === null;
  const { supportsShifts, supportsAnalysisActions } = deriveAnalysisCaps(
    song,
    status.isReady === true,
    keyPending,
  );
  const playbackDisabled = status.isReady !== true || preparingPlayback;

  // Off-queue key detection doesn't invalidate any query, so poll the song list
  // while the key is pending to pick it up and unlock the shift controls.
  useEffect(() => {
    if (!keyPending) {
      return undefined;
    }
    const interval = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: SONGS });
    }, 2000);
    return () => clearInterval(interval);
  }, [keyPending, queryClient]);

  const handlePlay = (players?: PlaybackPlayer[]) => {
    const target = reserveTarget();
    if (target === undefined) {
      return;
    }
    const start = (preparedSong: Song) =>
      launch({ song: preparedSong, queuePlayback: false, players }, target);
    const hasAdjustments = keyOffset !== song.key_offset || tempo !== song.tempo;

    if (!hasAdjustments) {
      void start(song);
      return;
    }

    preparePlayback(
      { song, tempo, keyOffset },
      {
        onSuccess: (preparedSong) => void start(preparedSong),
        onError: () => target?.close(),
      },
    );
  };

  return (
    <aside
      ref={detailsRef}
      className="flex min-h-0 min-w-0 flex-1 flex-col border-l bg-background [&_[data-song-details-focused=true]]:z-10 [&_[data-song-details-focused=true]]:ring-2 [&_[data-song-details-focused=true]]:ring-primary xl:w-96 xl:flex-none"
      aria-label="Song details"
    >
      <SongDetailsHeader
        song={song}
        queueStatus={queueStatus}
        bestScore={bestScores.get(song.file_hash)}
        onClose={closeDetails}
      />

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        <KeyTempoSection
          song={song}
          supportsShifts={supportsShifts}
          tempo={tempo}
          keyOffset={keyOffset}
          disabled={preparingPlayback}
          onTempoChange={setTempo}
          onKeyOffsetChange={setKeyOffset}
        />

        <Separator />

        <ActionsSection
          song={song}
          status={status}
          analysisBusy={analysisBusy}
          supportsAnalysisActions={supportsAnalysisActions}
        />
      </div>

      <footer
        className="flex gap-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        data-song-details-nav-group
      >
        <Button
          size="lg"
          className="h-8 flex-1 disabled:bg-primary/50 disabled:text-primary-foreground/45 disabled:opacity-100"
          disabled={playbackDisabled}
          aria-busy={preparingPlayback}
          onClick={() => handlePlay()}
        >
          {preparingPlayback ? (
            <>
              <Spinner className="size-4" /> Preparing playback…
            </>
          ) : (
            <>
              <PlayIcon /> Play
            </>
          )}
        </Button>
        <Button
          variant="outline"
          size="icon-lg"
          disabled={playbackDisabled}
          onClick={() => setMultiplayerOpen(true)}
          aria-label={`Play ${song.title} in multiplayer`}
          title="Play multiplayer"
        >
          <UsersIcon />
        </Button>
        <AddToQueueButton
          song={song}
          tempo={tempo}
          keyOffset={keyOffset}
          ready={status.isReady === true}
          preparing={preparingPlayback}
        />
      </footer>

      <MultiplayerSetupDialog
        open={multiplayerOpen}
        onOpenChange={setMultiplayerOpen}
        onStart={handlePlay}
      />
    </aside>
  );
};
