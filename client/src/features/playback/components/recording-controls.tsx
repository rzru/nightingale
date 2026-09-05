import { Circle, Pause, Play, Square, Trash2 } from 'lucide-react';
import { useEffect } from 'react';

import { usePlaybackRecording } from '@/features/playback/hooks/use-playback-recording';
import { Button } from '@/shared/components/ui/button';
import type { Song } from '@/types/Song';

const formatElapsed = (elapsedMs: number): string => {
  const totalSeconds = Math.floor(elapsedMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

type RecordingControlsProps = {
  song: Song;
  recordingsPath: string | null;
  onActiveChange: (active: boolean) => void;
};

type PlaybackRecording = ReturnType<typeof usePlaybackRecording>;

const idleLabel = (phase: PlaybackRecording['phase']): string => {
  if (phase === 'preparing') {
    return 'Preparing…';
  }
  if (phase === 'saving') {
    return 'Saving…';
  }
  return 'Record';
};

const unavailableMessage = (
  recordingsPath: string | null,
  micUserEnabled: boolean,
): string | null => {
  if (recordingsPath === null || recordingsPath === '') {
    return 'Choose a recordings folder in Playback settings';
  }
  if (!micUserEnabled) {
    return 'Turn the microphone on to record';
  }
  return null;
};

function IdleRecordingControl({
  recording,
  recordingsPath,
}: {
  recording: PlaybackRecording;
  recordingsPath: string | null;
}) {
  const unavailable = unavailableMessage(recordingsPath, recording.micUserEnabled);
  const statusMessage = unavailable ?? recording.errorMessage;

  return (
    <div className="pointer-events-auto fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 flex flex-col items-center gap-1">
      <Button
        type="button"
        variant="destructive"
        size="lg"
        disabled={!recording.canStart || recording.phase !== 'idle'}
        aria-label={recording.phase === 'saving' ? 'Saving recording' : 'Start recording'}
        onClick={recording.start}
      >
        <Circle className="fill-current" />
        {idleLabel(recording.phase)}
      </Button>
      {statusMessage !== null && (
        <p
          role={recording.errorMessage === statusMessage ? 'alert' : undefined}
          className="max-w-80 rounded-sm bg-black/60 px-2 py-1 text-center text-xs text-white/80"
        >
          {statusMessage}
        </p>
      )}
    </div>
  );
}

function ActiveRecordingControls({ recording }: { recording: PlaybackRecording }) {
  const paused = recording.phase === 'paused';

  return (
    <section
      aria-label="Recording controls"
      className="pointer-events-auto fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-red-400/30 bg-background/95 p-2 shadow-xl backdrop-blur-sm"
    >
      <output
        aria-live="off"
        aria-label={`Recording time ${formatElapsed(recording.elapsedMs)}`}
        className="mb-2 flex h-20 items-center justify-center rounded-lg bg-red-500/10 text-4xl font-semibold text-red-400 tabular-nums"
      >
        {formatElapsed(recording.elapsedMs)}
      </output>

      <div className="grid grid-cols-[auto_auto_1fr] gap-2">
        <Button
          type="button"
          variant="secondary"
          size="icon-lg"
          aria-label="Discard recording"
          onClick={recording.discard}
        >
          <Trash2 />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          aria-label={paused ? 'Resume recording' : 'Pause recording'}
          onClick={recording.togglePause}
        >
          {paused ? <Play className="fill-current" /> : <Pause className="fill-current" />}
        </Button>
        <Button type="button" variant="destructive" size="lg" onClick={recording.stop}>
          <Square className="fill-current" />
          Stop
        </Button>
      </div>
    </section>
  );
}

export function RecordingControls({
  song,
  recordingsPath,
  onActiveChange,
}: RecordingControlsProps) {
  const recording = usePlaybackRecording(song, recordingsPath);
  const active = recording.phase === 'recording' || recording.phase === 'paused';

  useEffect(() => {
    onActiveChange(active);

    return () => onActiveChange(false);
  }, [active, onActiveChange]);

  return active ? (
    <ActiveRecordingControls recording={recording} />
  ) : (
    <IdleRecordingControl recording={recording} recordingsPath={recordingsPath} />
  );
}
