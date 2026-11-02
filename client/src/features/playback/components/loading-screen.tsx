import { AlbumArt } from '@/features/library/components/song/album-art';
import { ShaderVisualizer } from '@/features/playback/components/shader-visualizer';
import { loadingFragment } from '@/features/playback/components/shaders';
import { Spinner } from '@/shared/components/ui/spinner';
import type { Song } from '@/types/Song';

type LoadingScreenProps = {
  song: Song;
};

export function LoadingScreen({ song }: LoadingScreenProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black">
      <ShaderVisualizer shaderIndex={0} isPlaying={true} customFragment={loadingFragment} />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-6 text-center">
        <AlbumArt
          song={song}
          className="size-40 rounded-lg shadow-2xl sm:size-56"
          fallbackIconClassName="size-16 text-white/50"
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
}
