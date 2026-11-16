import { useState } from 'react';
import { toast } from 'sonner';

import {
  chooseVideoBackground,
  exportVideo,
  type VideoStyle,
  type VideoProgress,
} from '@/bridge/video-export';
import { exportBackgroundName, exportBackgroundIsShader } from '@/bridge/video-export-background';
import {
  readVideoExportPreferences,
  saveVideoExportPreferences,
  type VideoExportPreferences,
} from '@/bridge/video-export-preferences';
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
import { useConfig } from '@/shared/config/use-config';
import type { AppConfig } from '@/types/AppConfig';
import type { Song } from '@/types/Song';

import { VideoColorPicker } from './video-color-picker';

const validTiming = (style: VideoStyle): boolean =>
  Number.isInteger(style.countdownSeconds) &&
  style.countdownSeconds >= 0 &&
  style.countdownSeconds <= 10 &&
  Number.isFinite(style.lyricsOffsetSeconds) &&
  Math.abs(style.lyricsOffsetSeconds) <= 30;

const exportDisabled = (busy: boolean, size: number): boolean =>
  busy || !Number.isInteger(size) || size < 20 || size > 120;

const previewTop = (position: number) => {
  if (position >= 7) {
    return '8%';
  }
  if (position >= 4) {
    return '45%';
  }
  return undefined;
};
const previewAlign = (position: number): 'left' | 'right' | 'center' => {
  if ((position - 1) % 3 === 0) {
    return 'left';
  }
  if ((position - 1) % 3 === 2) {
    return 'right';
  }
  return 'center';
};
const exportStatus = (
  preparing: number | undefined,
  busy: boolean,
  progress: VideoProgress,
): string => {
  if (preparing !== undefined) {
    return t('videoExport.preparing', { percent: preparing });
  }
  if (busy) {
    return t('videoExport.progress', {
      percent: progress.percent,
      seconds: progress.elapsedSeconds,
    });
  }
  return t('videoExport.note');
};

type Props = { song: Song; open: boolean; onClose: () => void };

const VideoBackgroundSummary = ({
  config,
  background,
  onReset,
}: {
  config: AppConfig;
  background: string;
  onReset: () => void;
}) => (
  <>
    <p className="break-all text-muted-foreground">
      {background === ''
        ? t('videoExport.selectedAppBackground', { name: exportBackgroundName(config) })
        : background.split(/[/\\]/).at(-1)}
    </p>
    {background !== '' && (
      <Button variant="ghost" onClick={() => onReset()}>
        {t('videoExport.useAppBackground')}
      </Button>
    )}
    {background === '' && exportBackgroundIsShader(config) && (
      <p className="text-muted-foreground">{t('videoExport.animatedBackgroundHint')}</p>
    )}
  </>
);

const VideoExportForm = ({ song, open, onClose, config }: Props & { config: AppConfig }) => {
  useTranslation();
  const [preferences, setPreferences] = useState(() => readVideoExportPreferences(config));
  const { style, background } = preferences;
  const [preparing, setPreparing] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<VideoProgress>({ percent: 0, elapsedSeconds: 0 });

  const updatePreferences = (next: VideoExportPreferences): void => {
    setPreferences(next);
    try {
      saveVideoExportPreferences(next);
    } catch {
      setError(t('videoExport.saveFailed'));
    }
  };
  const setStyle = (next: VideoStyle): void => updatePreferences({ ...preferences, style: next });
  const setBackground = (next: string): void =>
    updatePreferences({ ...preferences, background: next });

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
      const path = await exportVideo(
        { fileHash: song.file_hash, backgroundPath: background, style, config },
        { onProgress: setProgress, onPreparing: setPreparing },
      );
      if (path !== undefined) {
        toast.success(t('videoExport.complete'), { description: path });
        onClose();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPreparing(undefined);
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
          <VideoBackgroundSummary
            config={config}
            background={background}
            onReset={() => setBackground('')}
          />
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
            <label className="col-span-2 grid gap-1">
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
                value={Math.floor((style.position - 1) / 3)}
                onChange={(event) =>
                  setStyle({
                    ...style,
                    position: Number(event.target.value) * 3 + ((style.position - 1) % 3) + 1,
                  })
                }
              >
                <option value="2">{t('settings.constants.top')}</option>
                <option value="1">{t('settings.constants.center')}</option>
                <option value="0">{t('settings.constants.bottom')}</option>
              </select>
            </label>
            <label className="grid gap-1">
              {t('videoExport.horizontalPosition')}
              <select
                className="h-10 rounded-md border bg-background px-2"
                value={(style.position - 1) % 3}
                onChange={(event) =>
                  setStyle({
                    ...style,
                    position:
                      Math.floor((style.position - 1) / 3) * 3 + Number(event.target.value) + 1,
                  })
                }
              >
                <option value="0">{t('videoExport.left')}</option>
                <option value="1">{t('settings.constants.center')}</option>
                <option value="2">{t('videoExport.right')}</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <VideoColorPicker
              label={t('videoExport.textColor')}
              value={style.textColor}
              onChange={(textColor) => setStyle({ ...style, textColor })}
            />
            <VideoColorPicker
              label={t('videoExport.highlightColor')}
              value={style.highlightColor}
              onChange={(highlightColor) => setStyle({ ...style, highlightColor })}
            />
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
                  top: previewTop(style.position),
                  bottom: style.position <= 3 ? '8%' : undefined,
                  textAlign: previewAlign(style.position),
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
          {exportStatus(preparing, busy, progress)}
        </output>
        {busy && (
          <progress
            className="h-3 w-full accent-primary"
            max={100}
            value={preparing ?? progress.percent}
            aria-label={t('videoExport.busy')}
          />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t('common.actions.close')}
          </Button>
          <Button
            disabled={exportDisabled(busy, style.fontSize) || !validTiming(style)}
            onClick={() => void start()}
          >
            {busy ? t('videoExport.busy') : t('videoExport.title')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const VideoExportDialog = (props: Props) => {
  useTranslation();
  const { data: config, isError } = useConfig();
  if (config !== undefined) {
    return <VideoExportForm {...props} config={config} />;
  }
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          props.onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('videoExport.title')}</DialogTitle>
          <DialogDescription>
            {t(isError ? 'videoExport.settingsUnavailable' : 'videoExport.loadingSettings')}
          </DialogDescription>
        </DialogHeader>
        <Button onClick={props.onClose}>{t('common.actions.close')}</Button>
      </DialogContent>
    </Dialog>
  );
};
