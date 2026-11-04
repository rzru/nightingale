import type { CSSProperties } from 'react';

import { t } from '@/i18n';

type PlaybackPreviewProps = {
  lyricsVerticalPosition: string;
  lyricsHorizontalPosition: string;
  lyricsScale: number;
  pitchGraphScale: number;
};

const gridBackground: CSSProperties = {
  containerType: 'size',
  backgroundColor: '#070b14',
  backgroundImage:
    'radial-gradient(circle at 50% 35%, rgb(37 99 235 / 0.2), transparent 45%), linear-gradient(rgb(255 255 255 / 0.06) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.06) 1px, transparent 1px)',
  backgroundSize: 'auto, 5% 8.89%, 5% 8.89%',
};

function horizontalClass(position: string): string {
  if (position === 'left') {
    return 'items-start text-left';
  }
  if (position === 'right') {
    return 'items-end text-right';
  }
  return 'items-center text-center';
}

function verticalClass(position: string): string {
  if (position === 'top') {
    return 'top-[5.5%] justify-start';
  }
  if (position === 'center') {
    return 'inset-y-0 justify-center';
  }
  return 'bottom-[5.5%] justify-end';
}

export function PlaybackPreview({
  lyricsVerticalPosition,
  lyricsHorizontalPosition,
  lyricsScale,
  pitchGraphScale,
}: PlaybackPreviewProps) {
  const hudPosition = lyricsVerticalPosition === 'top' ? 'bottom' : 'top';

  return (
    <figure
      aria-label={t('settings.playbackPreview.playbackPreview')}
      className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 shadow-xl shadow-black/20"
      style={gridBackground}
    >
      <div
        className={`absolute inset-x-[1.5%] z-20 flex justify-between text-white ${
          hudPosition === 'bottom' ? 'bottom-[1.5%] items-end' : 'top-[1.5%] items-start'
        }`}
      >
        <div className={hudPosition === 'bottom' ? 'flex flex-col-reverse' : undefined}>
          <p className="leading-tight font-medium" style={{ fontSize: '2cqh' }}>
            Nightingale
          </p>
          <p className="text-white/65" style={{ fontSize: '1.45cqh' }}>
            {t('settings.playbackPreview.playbackPreview2')}
          </p>
          <p className="text-white/65" style={{ fontSize: '1.45cqh' }}>
            1:24 / 3:42
          </p>
        </div>
        <div
          className={`flex items-end ${hudPosition === 'bottom' ? 'flex-col-reverse' : 'flex-col'}`}
        >
          <p className="text-white/80" style={{ fontSize: '1.65cqh' }}>
            8420
          </p>
          <p className="text-white/40" style={{ fontSize: '1.1cqh' }}>
            {t('settings.playbackPreview.micDefaultMN')}
          </p>
          <p className="text-white/40" style={{ fontSize: '1.1cqh' }}>
            {t('settings.playbackPreview.themeGridT')}
          </p>
        </div>
      </div>

      <div
        className={`absolute left-1/2 z-20 w-[20.83%] -translate-x-1/2 rounded-[0.2cqh] border border-white/15 bg-black/45 p-[0.35cqh] ${
          hudPosition === 'bottom' ? 'bottom-[1.1%]' : 'top-[1.1%]'
        }`}
        style={{
          scale: String(pitchGraphScale),
          transformOrigin: hudPosition === 'bottom' ? 'center bottom' : 'center top',
        }}
      >
        <svg viewBox="0 0 400 44" className="block w-full" aria-hidden="true">
          <path
            d="M4 26 C45 12 70 14 105 24 S170 35 205 20 S270 8 310 22 S360 33 396 16"
            fill="none"
            stroke="rgb(128 179 255 / 0.65)"
            strokeWidth="3"
          />
          <path
            d="M4 31 C42 28 70 19 105 25 S165 39 207 24 S269 12 310 20 S360 28 396 14"
            fill="none"
            stroke="rgb(80 230 110 / 0.9)"
            strokeWidth="4"
          />
        </svg>
      </div>

      <div
        className={`pointer-events-none absolute inset-x-[3%] z-10 flex flex-col gap-[0.8cqh] ${verticalClass(lyricsVerticalPosition)} ${horizontalClass(lyricsHorizontalPosition)}`}
      >
        <div
          className="max-w-[78%] rounded-[0.7cqh] bg-black/45 px-[1.1cqh] py-[0.7cqh] leading-tight font-bold text-white shadow-lg"
          style={{ fontSize: `${3.7037 * lyricsScale}cqh` }}
        >
          {t('settings.playbackPreview.singLikeNobodyIsListening')}
        </div>
        <div
          className="max-w-[78%] rounded-[0.5cqh] bg-black/30 px-[0.9cqh] py-[0.5cqh] leading-tight text-white/40"
          style={{ fontSize: `${2.2222 * lyricsScale}cqh` }}
        >
          {t('settings.playbackPreview.letTheMusicCarryYouHome')}
        </div>
      </div>
    </figure>
  );
}
