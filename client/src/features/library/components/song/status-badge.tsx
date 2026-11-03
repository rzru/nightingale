import { LoaderCircleIcon } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { cn } from '@/shared/utils/cn';
import type { QueuedStatus } from '@/types/QueuedStatus';
import type { Song } from '@/types/Song';

import { formatTranscriptSource, getSongStatusInfo } from './song-status';

export function StatusBadge({ song, queueStatus }: { song: Song; queueStatus?: QueuedStatus }) {
  const status = getSongStatusInfo(song.is_analyzed, queueStatus);
  const source =
    status.isReady === true && song.transcript_source !== null
      ? formatTranscriptSource(song.transcript_source)
      : null;

  return (
    <Badge variant={status.variant} className={cn('border-foreground/15', status.className)}>
      {status.isAnalyzing === true ? <LoaderCircleIcon className="animate-spin" /> : null}
      {source ?? status.label}
    </Badge>
  );
}
