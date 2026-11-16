import { useState } from 'react';
import { toast } from 'sonner';

import {
  chooseVideoBackground,
  exportVideo,
  type VideoStyle,
  type VideoProgress,
} from '@/bridge/video-export';
import { t, useTranslation } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import type { Song } from '@/types/Song';

const initialStyle: VideoStyle = {
  width: 1920,
  height: 1080,
  font: 'Arial',
  fontSize: 64,
  textColor: '#ffffff',
  highlightColor: '#ffffff',
  position: 2,
  guideVolume: 0,
  countdownSeconds: 3,
  lyricsOffsetSeconds: 0,
};

const validTiming = (style: VideoStyle): boolean =>
  Number.isInteger(style.countdownSeconds) &&
  style.countdownSeconds >= 0 &&
  style.countdownSeconds <= 10 &&
  Number.isFinite(style.lyricsOffsetSeconds) &&
  Math.abs(style.lyricsOffsetSeconds) <= 30;

const exportDisabled = (busy: boolean, background: string, size: number): boolean =>
  busy || background === '' || !Number.isInteger(size) || size < 20 || size > 120;

type Props = { song: Song; open: boolean; onClose: () => void };

export const VideoExportDialog = ({ song, open, onClose }: Props) => {
  useTranslation();
  const [style, setStyle] = useState(initialStyle);
  const [background, setBackground] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<VideoProgress>({ percent: 0, elapsedSeconds: 0 });

  const chooseBackground = async (): Promise<void> => {
    try {
      const path = await chooseVideoBackground();
      if (path !== undefined) {
        setBackground(path);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const start = async (): Promise<void> => {
    setBusy(true);
    setError('');
    setProgress({ percent: 0, elapsedSeconds: 0 });
    try {
      const path = await exportVideo(song.file_hash, background, style, setProgress);
      if (path !== undefined) {
        toast.success(t('videoExport.complete'), { description: path });
        onClose();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{t('videoExport.title')}</DialogTitle>
          <DialogDescription>{t('videoExport.description')}</DialogDescription>
        </DialogHeader>
        <fieldset disabled={busy} className="grid gap-4">
          <p className="text-muted-foreground">{t('videoExport.existingTiming')}</p>
          <Button variant="outline" onClick={() => void chooseBackground()}>
            {t('videoExport.background')}
          </Button>
          <p className="break-all text-muted-foreground">
            {background === '' ? t('videoExport.noBackground') : background.split(/[/\\]/).at(-1)}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <label className="grid gap-1">
              {t('videoExport.resolution')}
              <select
                className="h-10 rounded-md border bg-background px-2"
                value={`${style.width}x${style.height}`}
                onChange={(event) => {
                  const [width, height] = event.target.value.split('x').map(Number);
                  setStyle({ ...style, width, height });
                }}
              >
                <option value="1280x720">1280 × 720 (16:9)</option>
                <option value="1920x1080">1920 × 1080 (16:9)</option>
                <option value="1080x1920">1080 × 1920 (9:16)</option>
              </select>
            </label>
            <label className="grid gap-1">
              {t('videoExport.font')}
              <select
                className="h-10 rounded-md border bg-background px-2"
                value={style.font}
                onChange={(event) => setStyle({ ...style, font: event.target.value })}
              >
                {['Arial', 'Verdana', 'Georgia', 'Tahoma'].map((font) => (
                  <option key={font}>{font}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              {t('videoExport.size')}
              <Input
                type="number"
                min={20}
                max={120}
                value={style.fontSize}
                onChange={(event) => setStyle({ ...style, fontSize: Number(event.target.value) })}
              />
            </label>
            <label className="grid gap-1">
              {t('videoExport.position')}
              <select
                className="h-10 rounded-md border bg-background px-2"
                value={style.position}
                onChange={(event) => setStyle({ ...style, position: Number(event.target.value) })}
              >
                <option value="8">{t('settings.constants.top')}</option>
                <option value="5">{t('settings.constants.center')}</option>
                <option value="2">{t('settings.constants.bottom')}</option>
              </select>
            </label>
            <label className="grid gap-1">
              {t('videoExport.textColor')}
              <Input
                type="color"
                className="h-10"
                value={style.textColor}
                onChange={(event) => setStyle({ ...style, textColor: event.target.value })}
              />
            </label>
            <label className="grid gap-1">
              {t('videoExport.highlightColor')}
              <Input
                type="color"
                className="h-10"
                value={style.highlightColor}
                onChange={(event) => setStyle({ ...style, highlightColor: event.target.value })}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <label className="grid gap-1">
              {t('videoExport.countdown')}
              <Input
                type="number"
                min={0}
                max={10}
                step={1}
                value={style.countdownSeconds}
                onChange={(event) =>
                  setStyle({ ...style, countdownSeconds: Number(event.target.value) })
                }
              />
            </label>
            <label className="grid gap-1">
              {t('videoExport.offset')}
              <Input
                type="number"
                min={-30}
                max={30}
                step={0.1}
                value={style.lyricsOffsetSeconds}
                onChange={(event) =>
                  setStyle({ ...style, lyricsOffsetSeconds: Number(event.target.value) })
                }
              />
            </label>
          </div>
          <p className="text-muted-foreground">{t('videoExport.timingHint')}</p>
          <label className="grid gap-1">
            {t('videoExport.guide', { percent: style.guideVolume })}
            <input
              type="range"
              min="0"
              max="100"
              value={style.guideVolume}
              onChange={(event) => setStyle({ ...style, guideVolume: Number(event.target.value) })}
            />
          </label>
          <div>
            <p className="mb-2 text-muted-foreground">{t('videoExport.preview')}</p>
            <div
              className="relative overflow-hidden rounded-lg bg-black"
              style={{ aspectRatio: `${style.width}/${style.height}`, maxHeight: 230 }}
            >
              <p
                className="absolute right-3 left-3 text-center font-bold"
                style={{
                  top: { 8: '8%', 5: '45%' }[style.position],
                  bottom: style.position === 2 ? '8%' : undefined,
                  color: style.textColor,
                  fontFamily: style.font,
                  fontSize: `${style.fontSize * 0.25}px`,
                  textShadow: '1px 1px 2px black',
                }}
              >
                <span style={{ color: style.highlightColor }}>
                  {t('videoExport.previewHighlight')}
                </span>{' '}
                <span className="opacity-50">{t('videoExport.previewText')}</span>
                <span className="mt-2 block text-[0.6em] font-normal opacity-35">
                  {t('settings.playbackPreview.letTheMusicCarryYouHome')}
                </span>
              </p>
            </div>
          </div>
        </fieldset>
        {error !== '' && (
          <p role="alert" className="text-destructive">
            {t('library.songActions.exportFailed', { error })}
          </p>
        )}
        <output aria-live="polite" className="text-muted-foreground">
          {busy
            ? t('videoExport.progress', {
                percent: progress.percent,
                seconds: progress.elapsedSeconds,
              })
            : t('videoExport.note')}
        </output>
        {busy && (
          <progress
            className="h-3 w-full accent-primary"
            max={100}
            value={progress.percent}
            aria-label={t('videoExport.busy')}
          />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t('common.actions.close')}
          </Button>
          <Button
            disabled={exportDisabled(busy, background, style.fontSize) || !validTiming(style)}
            onClick={() => void start()}
          >
            {busy ? t('videoExport.busy') : t('videoExport.title')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
