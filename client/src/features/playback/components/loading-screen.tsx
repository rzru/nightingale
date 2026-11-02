import { memo } from 'react';

import { AlbumArt } from '@/features/library/components/song/album-art';
import { Spinner } from '@/shared/components/ui/spinner';
import type { Song } from '@/types/Song';

type LoadingScreenProps = {
  song: Song;
};

export const LoadingScreen = memo(function LoadingScreen({ song }: LoadingScreenProps) {
  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-[#05030d]"
      style={{
        background:
          'radial-gradient(circle at 50% 45%, rgb(126 78 184 / 35%) 0%, transparent 48%), radial-gradient(circle at 25% 30%, rgb(68 102 164 / 18%) 0%, transparent 44%), #05030d',
      }}
    >
      <div
        className="pointer-events-none absolute top-1/2 left-1/2 h-[110vmax] w-[110vmax] -translate-x-1/2 -translate-y-1/2"
        aria-hidden="true"
      >
        <div
          className="absolute inset-[8%] animate-spin rounded-full opacity-60 blur-3xl will-change-transform motion-reduce:animate-none"
          style={{
            animationDuration: '24s',
            background:
              'conic-gradient(from 20deg, transparent 0deg, rgb(86 111 190 / 55%) 55deg, transparent 115deg, rgb(143 72 195 / 60%) 190deg, transparent 255deg, rgb(48 115 172 / 45%) 315deg, transparent 360deg)',
          }}
        />
        <div
          className="absolute inset-[24%] animate-spin rounded-[42%] opacity-70 blur-2xl will-change-transform motion-reduce:animate-none"
          style={{
            animationDirection: 'reverse',
            animationDuration: '16s',
            background:
              'conic-gradient(from 0deg, transparent 0deg, rgb(176 87 211 / 50%) 70deg, transparent 145deg, rgb(75 126 202 / 45%) 230deg, transparent 310deg)',
          }}
        />
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-6 text-center">
        <AlbumArt
          song={song}
          className="size-40 rounded-lg shadow-2xl sm:size-56"
          fallbackIconClassName="size-16 text-white/50"
          lazy={false}
        />
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-balance text-white sm:text-2xl">
            {song.title}
          </h1>
          <p className="text-base text-white/70 sm:text-lg">{song.artist}</p>
        </div>
        <Spinner className="size-6 text-white/70" />
      </div>
    </div>
  );
});
