import { memo } from 'react';
import { toast } from 'sonner';

import { usePlaybackMicActions } from '@/features/playback/providers/playback-mic-context';
import { usePlaybackThemeState } from '@/features/playback/providers/playback-theme-context';
import { usePlaybackTransportState } from '@/features/playback/providers/playback-transport-context';

import { CustomBackground } from './custom-background';
import { PitchGuideBackground } from './pitch-guide-background';
import { PixabayVideo } from './pixabay-video';
import { ShaderVisualizer } from './shader-visualizer';
import { SourceVideo } from './source-video';
import { PITCH_GUIDE_SHADER_ID } from './theme';

function ShaderBranch({
  id,
  shaderIndex,
  isPlaying,
}: {
  id: string;
  shaderIndex: number;
  isPlaying: boolean;
}) {
  const { reactiveRef } = usePlaybackMicActions();
  if (id === PITCH_GUIDE_SHADER_ID) {
    return (
      <PitchGuideBackground
        shaderIndex={shaderIndex}
        isPlaying={isPlaying}
        reactiveRef={reactiveRef}
      />
    );
  }
  return (
    <ShaderVisualizer shaderIndex={shaderIndex} isPlaying={isPlaying} reactiveRef={reactiveRef} />
  );
}

function CustomBranch({ isPlaying }: { isPlaying: boolean }) {
  const { theme } = usePlaybackThemeState();
  const { reactiveRef } = usePlaybackMicActions();
  if (theme.kind !== 'custom') {
    return null;
  }
  return (
    <CustomBackground
      key={theme.background.id}
      background={theme.background}
      isPlaying={isPlaying}
      reactiveRef={reactiveRef}
      onError={(message) => toast.error(`Background error: ${message}`)}
    />
  );
}

function BackgroundImpl() {
  const { isPlaying } = usePlaybackTransportState();
  const { theme, videoFlavor, sourceVideoPath } = usePlaybackThemeState();

  return (
    <div className="fixed inset-0">
      {typeof sourceVideoPath === 'string' && sourceVideoPath !== '' && (
        <SourceVideo isActive={theme.kind === 'source'} />
      )}
      {theme.kind === 'shader' && (
        <ShaderBranch id={theme.id} shaderIndex={theme.shaderIndex} isPlaying={isPlaying} />
      )}
      {theme.kind === 'pixabay' && <PixabayVideo flavor={videoFlavor} isPlaying={isPlaying} />}
      {theme.kind === 'custom' && <CustomBranch isPlaying={isPlaying} />}
    </div>
  );
}

export const Background = memo(BackgroundImpl);
