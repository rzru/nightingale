import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { playbackAdapter } from '@/bridge/playback';
import { discardRecording, renderRecordingVoice, saveRecording } from '@/bridge/recording';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { Slider } from '@/shared/components/ui/slider';
import { useConfig } from '@/shared/config/use-config';
import type { Song } from '@/types/Song';

/** A finished take waiting on the results screen. */
export type RecordingTake = {
  take: string;
  voicePath: string;
  /** Shift already applied to the voice: the measured microphone latency. */
  latencySec: number;
};

type Props = {
  take: RecordingTake;
  song: Song;
  profile: string | null;
  /** The take is gone from the temporary folder: saved or deleted. */
  onDone: () => void;
};

const NUDGE_MS = 20;

const errorText = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** Listen to the mixed performance and keep or delete it. */
export function RecordingPanel({ take, song, profile, onDone }: Props) {
  const { data: config } = useConfig();
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const voiceRef = useRef<HTMLAudioElement | null>(null);
  const [voicePath, setVoicePath] = useState(take.voicePath);
  const [revision, setRevision] = useState(0);
  const [nudgeMs, setNudgeMs] = useState(0);
  const [voiceGain, setVoiceGain] = useState(1);
  const [musicGain, setMusicGain] = useState(0.8);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const music = new Audio();
    const voice = new Audio();
    musicRef.current = music;
    voiceRef.current = voice;
    const onEnded = () => setPlaying(false);
    music.addEventListener('ended', onEnded);
    void playbackAdapter
      .getAudioPaths(song.file_hash)
      .then((paths) => {
        music.src = paths.instrumental;
        return undefined;
      })
      .catch((cause: unknown) => toast.error(errorText(cause)));
    return () => {
      music.removeEventListener('ended', onEnded);
      music.pause();
      voice.pause();
      music.removeAttribute('src');
      voice.removeAttribute('src');
    };
  }, [song.file_hash]);

  // The voice file is rewritten in place after a shift: a new query reloads it.
  useEffect(() => {
    const voice = voiceRef.current;
    if (voice !== null) {
      voice.src = `${playbackAdapter.toMediaUrl(voicePath)}?r=${revision}`;
    }
  }, [revision, voicePath]);

  useEffect(() => {
    if (musicRef.current) {
      musicRef.current.volume = Math.min(1, musicGain);
    }
    if (voiceRef.current) {
      voiceRef.current.volume = Math.min(1, voiceGain);
    }
  }, [musicGain, voiceGain]);

  const togglePlay = () => {
    const music = musicRef.current;
    const voice = voiceRef.current;
    if (music === null || voice === null) {
      return;
    }
    if (playing) {
      music.pause();
      voice.pause();
      setPlaying(false);
      return;
    }
    voice.currentTime = music.currentTime;
    void Promise.all([music.play(), voice.play()]).catch((cause: unknown) => {
      toast.error(errorText(cause));
      setPlaying(false);
    });
    setPlaying(true);
  };

  const shiftVoice = async (deltaMs: number) => {
    const next = nudgeMs + deltaMs;
    setBusy(true);
    try {
      const path = await renderRecordingVoice(take.take, take.latencySec + next / 1000);
      setNudgeMs(next);
      setVoicePath(path);
      setRevision((value) => value + 1);
    } catch (cause) {
      toast.error(t('playback.recording.failed', { error: errorText(cause) }));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const path = await saveRecording({
        take: take.take,
        fileHash: song.file_hash,
        voiceGain,
        musicGain,
        format: config?.recording_format ?? 'mp3',
        artist: song.artist,
        title: song.title,
        profile,
      });
      toast.success(t('playback.recording.saved'), { description: path });
      onDone();
    } catch (cause) {
      toast.error(t('playback.recording.failed', { error: errorText(cause) }));
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await discardRecording(take.take);
      onDone();
    } catch (cause) {
      toast.error(t('playback.recording.failed', { error: errorText(cause) }));
      setBusy(false);
    }
  };

  return (
    <section
      className="flex flex-col gap-3 rounded-md border p-3"
      aria-labelledby="recording-panel-title"
    >
      <h3 id="recording-panel-title" className="text-sm font-semibold">
        {t('playback.recording.title')}
      </h3>
      <Button variant="outline" disabled={busy} onClick={togglePlay}>
        {playing ? t('common.actions.pause') : t('playback.recording.listen')}
      </Button>
      <div className="flex flex-col gap-1">
        <Label>
          {t('playback.recording.voiceVolume', { percent: Math.round(voiceGain * 100) })}
        </Label>
        <Slider
          min={0}
          max={200}
          step={5}
          value={[Math.round(voiceGain * 100)]}
          onValueChange={([pct]) => setVoiceGain(pct / 100)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label>
          {t('playback.recording.musicVolume', { percent: Math.round(musicGain * 100) })}
        </Label>
        <Slider
          min={0}
          max={200}
          step={5}
          value={[Math.round(musicGain * 100)]}
          onValueChange={([pct]) => setMusicGain(pct / 100)}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs text-muted-foreground">
          {t('playback.recording.voiceShift', { value: nudgeMs > 0 ? `+${nudgeMs}` : nudgeMs })}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          aria-label={t('playback.recording.voiceEarlier')}
          onClick={() => void shiftVoice(NUDGE_MS)}
        >
          −{NUDGE_MS}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          aria-label={t('playback.recording.voiceLater')}
          onClick={() => void shiftVoice(-NUDGE_MS)}
        >
          +{NUDGE_MS}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button disabled={busy} onClick={() => void save()}>
          {t('playback.recording.save')}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void remove()}>
          {t('playback.recording.delete')}
        </Button>
      </div>
    </section>
  );
}
