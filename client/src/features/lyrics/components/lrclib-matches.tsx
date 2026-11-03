import { Loader2Icon } from 'lucide-react';

import { formatSeconds } from '@/features/lyrics/utils/edit-lyrics';
import { t, tp } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import type { LrclibCandidate } from '@/types/LrclibCandidate';

import { ringFor } from './parts';

type LrclibMatchesProps = {
  candidates: LrclibCandidate[];
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  index: number;
  onSelect: (candidate: LrclibCandidate) => void;
  onUseLrc: (candidate: LrclibCandidate) => void;
  isFocused: (slot: number) => boolean;
};

type CandidateProps = Pick<LrclibMatchesProps, 'onSelect' | 'onUseLrc' | 'isFocused'> & {
  candidate: LrclibCandidate;
};

const Candidate = ({ candidate, onSelect, onUseLrc, isFocused }: CandidateProps) => {
  const hasLrc = candidate.synced_lyrics !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{candidate.track_name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {candidate.artist_name}
          {candidate.album_name ? ` • ${candidate.album_name}` : ''} •{' '}
          {formatSeconds(candidate.duration_secs)} •{' '}
          {tp('lyrics.lrclib.lineCount', candidate.lines.length)}
          {hasLrc && <span className="text-primary">{t('lyrics.lrclibMatches.lrcAvailable')}</span>}
        </span>
        <div className="mt-1.5 flex items-center gap-2">
          {hasLrc && (
            <Button
              size="xs"
              variant="default"
              onClick={() => onUseLrc(candidate)}
              className={ringFor(isFocused(0))}
            >
              {t('lyrics.lrclibMatches.useLrc')}
            </Button>
          )}
          <Button
            size="xs"
            variant={hasLrc ? 'outline' : 'default'}
            onClick={() => onSelect(candidate)}
            className={ringFor(isFocused(hasLrc ? 1 : 0))}
          >
            {t('lyrics.lrclibMatches.useAsPlainText')}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
        <pre className="px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
          {hasLrc ? candidate.synced_lyrics : candidate.lines.join('\n')}
        </pre>
      </div>
    </div>
  );
};

export const LrclibMatches = ({
  candidates,
  isLoading,
  isError,
  errorMessage,
  index,
  onSelect,
  onUseLrc,
  isFocused,
}: LrclibMatchesProps) => {
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        <span>{t('lyrics.lrclibMatches.searchingLrclib')}</span>
      </div>
    );
  }
  if (isError) {
    return <p className="text-destructive">{errorMessage ?? t('lyrics.lrclib.loadError')}</p>;
  }
  if (candidates.length === 0) {
    return (
      <p className="text-muted-foreground">
        {t('lyrics.lrclibMatches.noLrclibMatchesFoundForThisSong')}
      </p>
    );
  }

  const candidate = candidates[Math.min(index, candidates.length - 1)];
  return (
    <Candidate
      candidate={candidate}
      onSelect={onSelect}
      onUseLrc={onUseLrc}
      isFocused={isFocused}
    />
  );
};
