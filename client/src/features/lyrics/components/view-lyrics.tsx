import { useEffect, useState, type ReactNode } from 'react';

import { loadTranscript } from '@/bridge/playback';
import { useDialog, type DialogMode } from '@/features/menu/hooks/use-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import type { Song } from '@/types/Song';
import type { Transcript } from '@/types/Transcript';

const viewedSong = (mode: DialogMode): Song | null =>
  typeof mode === 'object' && mode !== null && mode.mode === 'view-lyrics' ? mode.song : null;

type LyricsResult = { hash: string; lines?: string[]; error?: string };

const renderBody = (current: LyricsResult | null): ReactNode => {
  if (current === null) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (current.error !== undefined) {
    return <p className="text-sm text-destructive">Couldn’t load lyrics: {current.error}</p>;
  }
  if (current.lines !== undefined && current.lines.length > 0) {
    return (
      <pre className="font-sans text-sm leading-relaxed whitespace-pre-wrap">
        {current.lines.join('\n')}
      </pre>
    );
  }
  return <p className="text-sm text-muted-foreground">No lyrics available for this song.</p>;
};

/**
 * Read-only lyrics viewer. A `.nge` is a sealed bundle, so its lyrics can't be
 * edited in place — but they're always viewable. Lines are derived from the
 * song's transcript (read from the bundle in memory), which every analyzed song
 * carries.
 */
export const ViewLyricsDialog = () => {
  const { mode, close } = useDialog();
  const song = viewedSong(mode);
  const open = song !== null;
  const fileHash = song?.file_hash ?? null;

  const [result, setResult] = useState<LyricsResult | null>(null);

  useEffect(() => {
    const state = { cancelled: false };
    if (fileHash !== null) {
      void (async () => {
        try {
          const transcript: Transcript = await loadTranscript(fileHash);
          if (!state.cancelled) {
            const lines = transcript.segments
              .map((segment) => segment.text.trim())
              .filter((text) => text.length > 0);
            setResult({ hash: fileHash, lines });
          }
        } catch (error) {
          if (!state.cancelled) {
            setResult({
              hash: fileHash,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      })();
    }
    return () => {
      state.cancelled = true;
    };
  }, [fileHash]);

  const current = result?.hash === fileHash ? result : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          close();
        }
      }}
    >
      <DialogContent className="flex h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Lyrics</DialogTitle>
          <DialogDescription>
            {song !== null ? `${song.title} — ${song.artist}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-muted/30 p-4">
          {renderBody(current)}
        </div>
      </DialogContent>
    </Dialog>
  );
};
