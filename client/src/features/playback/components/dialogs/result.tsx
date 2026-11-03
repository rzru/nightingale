import { TrophyIcon } from 'lucide-react';
import { useState } from 'react';

import type { PlaybackPlayer } from '@/bridge/playback-session';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import { MultiplayerSetupDialog } from '@/features/playback/components/dialogs/multiplayer-setup';
import type { PlaybackPlayerResult } from '@/features/playback/hooks/use-playback-result';
import { playerDisplayName } from '@/features/playback/utils/player-display-name';
import { topScoresForSong } from '@/features/playback/utils/result';
import { t } from '@/i18n';
import { Stars } from '@/shared/components/shared/stars';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Spinner } from '@/shared/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { defaultPlayerColor, playerColorOption } from '@/shared/player-colors';
import { cn } from '@/shared/utils/cn';
import type { ScoreRecord } from '@/types/ScoreRecord';
import type { Song } from '@/types/Song';

const TOP_LIMIT = 5;
const RING = 'ring-2 ring-primary';
const NO_FOCUS_RING = 'focus-visible:ring-0 focus-visible:border-transparent';
const EMPTY_RESULT: PlaybackPlayerResult = {
  id: 'solo',
  profile: null,
  color: defaultPlayerColor(0),
  score: 0,
};

type Props = {
  open: boolean;
  results: PlaybackPlayerResult[];
  song: Song;
  scores: ScoreRecord[];
  nextPending: boolean;
  exitLabel: string;
  onBack: () => void;
  onNext?: (players?: readonly PlaybackPlayer[]) => void;
};

const resultDialogWidth = (multiplayer: boolean): string =>
  multiplayer ? 'sm:max-w-md' : 'sm:max-w-sm';

function MultiplayerResults({ results }: { results: PlaybackPlayerResult[] }) {
  return (
    <Table aria-label={t('playback.dialogs.result.multiplayerResults')}>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-12">#</TableHead>
          <TableHead>{t('playback.dialogs.result.player')}</TableHead>
          <TableHead className="text-right">{t('playback.dialogs.result.score')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {results.map((result, index) => {
          return (
            <TableRow key={result.id} className={cn(index === 0 && 'bg-primary/10')}>
              <TableCell className="tabular-nums">{index + 1}</TableCell>
              <TableCell>
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`size-2.5 shrink-0 rounded-full ${playerColorOption(result.color).className}`}
                    aria-hidden="true"
                  />
                  <span className="truncate font-medium">{playerDisplayName(result, results)}</span>
                  {index === 0 ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-primary">
                      <TrophyIcon className="size-3" />
                      {t('playback.dialogs.result.winner')}
                    </span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-3">
                  <Stars score={result.score} size="sm" />
                  <span className="min-w-8 text-right font-semibold tabular-nums">
                    {result.score}
                  </span>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function SoloResults({ result, board }: { result: PlaybackPlayerResult; board: ScoreRecord[] }) {
  return (
    <>
      <div className="flex flex-col items-center gap-1">
        <p
          className="text-4xl font-semibold text-primary tabular-nums"
          aria-label={t('playback.result.scoreLabel', { score: result.score })}
        >
          {result.score}
        </p>
        <Stars score={result.score} size="lg" className="mt-1" />
      </div>

      {board.length > 0 ? (
        <>
          <div className="h-px w-full bg-border" />
          <p className="text-center text-[11px] font-medium tracking-wide text-muted-foreground">
            {t('playback.dialogs.result.bestScores')}
          </p>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 text-xs">#</TableHead>
                <TableHead className="h-8 text-xs">
                  {t('playback.dialogs.result.profile')}
                </TableHead>
                <TableHead className="h-8 text-right text-xs">
                  {t('playback.dialogs.result.score')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {board.map(({ profile, score }, index) => {
                const isCurrent = profile === result.profile && score === result.score;
                return (
                  <TableRow key={profile} className={cn(isCurrent && 'bg-primary/10')}>
                    <TableCell className="py-2 text-xs tabular-nums">{index + 1}</TableCell>
                    <TableCell
                      className={cn('py-2 text-xs', isCurrent && 'font-medium text-primary')}
                    >
                      {profile}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'py-2 text-right text-xs tabular-nums',
                        isCurrent && 'font-medium text-primary',
                      )}
                    >
                      {score}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </>
      ) : null}
    </>
  );
}

type ResultActionsProps = Pick<
  Props,
  'open' | 'nextPending' | 'exitLabel' | 'onBack' | 'onNext'
> & {
  multiplayer: boolean;
};

type ActionButtonProps = {
  open: boolean;
  focusedIndex: number;
  nextPending: boolean;
};

function ChangePlayersButton({
  show,
  onClick,
  ...props
}: ActionButtonProps & { show: boolean; onClick: () => void }) {
  if (!show) {
    return null;
  }
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(
        'w-full sm:w-auto',
        NO_FOCUS_RING,
        props.open && props.focusedIndex === 1 && RING,
      )}
      disabled={props.nextPending}
      onClick={onClick}
    >
      {t('playback.dialogs.result.changePlayers')}
    </Button>
  );
}

function NextSongButton({
  nextIndex,
  onNext,
  ...props
}: ActionButtonProps & { nextIndex: number; onNext: Props['onNext'] }) {
  if (!onNext) {
    return null;
  }
  return (
    <Button
      type="button"
      className={cn(
        'w-full sm:w-auto',
        NO_FOCUS_RING,
        props.open && props.focusedIndex === nextIndex && RING,
      )}
      disabled={props.nextPending}
      aria-busy={props.nextPending}
      onClick={() => onNext()}
    >
      {props.nextPending ? (
        <>
          <Spinner className="size-4" />
          {t('playback.dialogs.result.preparing')}
        </>
      ) : (
        t('playback.result.nextSong')
      )}
    </Button>
  );
}

function NextSongSetup({
  show,
  open,
  onOpenChange,
  onStart,
}: {
  show: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: NonNullable<Props['onNext']>;
}) {
  if (!show) {
    return null;
  }
  return (
    <MultiplayerSetupDialog
      open={open}
      onOpenChange={onOpenChange}
      onStart={onStart}
      queuePlayback
      submitLabel={t('playback.result.startNextSong')}
    />
  );
}

function ResultActions({
  open,
  multiplayer,
  nextPending,
  exitLabel,
  onBack,
  onNext,
}: ResultActionsProps) {
  const [setupOpen, setSetupOpen] = useState(false);
  const canChangePlayers = multiplayer && onNext !== undefined;
  const nextIndex = canChangePlayers ? 2 : 1;
  const startNext = onNext ?? (() => {});
  const { focusedIndex } = useDialogNav({
    open: open && !setupOpen && !nextPending,
    itemCount: onNext ? nextIndex + 1 : 1,
    onConfirm: (index) => {
      if (index === 0) {
        onBack();
      } else if (canChangePlayers && index === 1) {
        setSetupOpen(true);
      } else {
        startNext();
      }
    },
    onBack,
  });

  return (
    <>
      <DialogFooter className="mt-2 flex-col sm:flex-row sm:justify-center">
        <Button
          type="button"
          variant="outline"
          className={cn('w-full sm:w-auto', NO_FOCUS_RING, open && focusedIndex === 0 && RING)}
          disabled={nextPending}
          onClick={onBack}
        >
          {exitLabel}
        </Button>
        <ChangePlayersButton
          show={canChangePlayers}
          open={open}
          focusedIndex={focusedIndex}
          nextPending={nextPending}
          onClick={() => setSetupOpen(true)}
        />
        <NextSongButton
          open={open}
          focusedIndex={focusedIndex}
          nextPending={nextPending}
          nextIndex={nextIndex}
          onNext={onNext}
        />
      </DialogFooter>

      <NextSongSetup
        show={canChangePlayers}
        open={setupOpen}
        onOpenChange={setSetupOpen}
        onStart={startNext}
      />
    </>
  );
}

export const ResultDialog = ({
  open,
  results,
  song,
  scores,
  nextPending,
  exitLabel,
  onBack,
  onNext,
}: Props) => {
  const multiplayer = results.length > 1;
  const soloResult = results.at(0) ?? EMPTY_RESULT;
  const board = topScoresForSong(scores, song.file_hash, TOP_LIMIT);

  return (
    <Dialog open={open} modal>
      <DialogContent
        showCloseButton={false}
        className={cn('overflow-visible p-0', resultDialogWidth(multiplayer))}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <div className="flex flex-col gap-4 p-7">
          <DialogHeader className="gap-1 text-center sm:text-center">
            <DialogTitle className="text-xl font-semibold">{song.title}</DialogTitle>
            <DialogDescription className="text-sm">{song.artist}</DialogDescription>
          </DialogHeader>

          {multiplayer ? (
            <MultiplayerResults results={results} />
          ) : (
            <SoloResults result={soloResult} board={board} />
          )}

          <ResultActions
            open={open}
            multiplayer={multiplayer}
            nextPending={nextPending}
            exitLabel={exitLabel}
            onBack={onBack}
            onNext={onNext}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};
