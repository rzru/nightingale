import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';

import { loadCustomShaderSource, resolveCustomBackgroundUrl } from '@/bridge/backgrounds';
import type { MicReactiveRef } from '@/features/microphone/hooks/use-mic-reactive';
import { useBackgroundLifecycle } from '@/features/playback/components/background-lifecycle-context';
import { customFragmentShader, validateCustomShader } from '@/features/playback/lib/custom-shader';
import { t } from '@/i18n';
import type { CustomBackground as CustomBackgroundDefinition } from '@/types/CustomBackground';

import { ShaderVisualizer } from './shader-visualizer';

const SURFACE_CLASS = 'pointer-events-none absolute inset-0 size-full object-cover';

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return reduced;
}

function CustomVideo({ src, name, playing }: { src: string; name: string; playing: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const { ready, failed } = useBackgroundLifecycle();
  const fail = useCallback(() => failed(`${name} could not be loaded`), [failed, name]);

  useEffect(() => {
    const video = ref.current;
    if (video === null) {
      return;
    }
    if (playing) {
      void video.play().catch(fail);
    } else {
      video.pause();
    }
  }, [fail, playing]);

  return (
    <video
      ref={ref}
      aria-hidden="true"
      className={SURFACE_CLASS}
      src={src}
      preload="auto"
      loop
      muted
      playsInline
      onCanPlay={ready}
      onError={fail}
    />
  );
}

type CustomBackgroundProps = {
  background: CustomBackgroundDefinition;
  isPlaying: boolean;
  reactiveRef?: MicReactiveRef;
};

type BackgroundSurfaceProps = {
  background: CustomBackgroundDefinition;
  isPlaying: boolean;
  reactiveRef?: MicReactiveRef;
  reducedMotion: boolean;
  shader: string | null;
  assetUrl: string | null;
};

function ReactiveShader({
  isPlaying,
  reducedMotion,
  reactiveRef,
  fragment,
}: {
  isPlaying: boolean;
  reducedMotion: boolean;
  reactiveRef?: MicReactiveRef;
  fragment?: string;
}) {
  const { ready } = useBackgroundLifecycle();

  return (
    <ShaderVisualizer
      shaderIndex={0}
      isPlaying={isPlaying && !reducedMotion}
      reactiveRef={reducedMotion ? undefined : reactiveRef}
      customFragment={fragment}
      onReady={ready}
    />
  );
}

function BackgroundSurface({
  background,
  isPlaying,
  reactiveRef,
  reducedMotion,
  shader,
  assetUrl,
}: BackgroundSurfaceProps) {
  const { ready, failed } = useBackgroundLifecycle();
  const mediaError = useCallback(
    () => failed(`${background.name} could not be loaded`),
    [background.name, failed],
  );
  const imageLoaded = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      void event.currentTarget.decode().then(ready).catch(mediaError);
    },
    [mediaError, ready],
  );
  if (background.background_type === 'shader') {
    return shader !== null ? (
      <ReactiveShader
        isPlaying={isPlaying}
        reducedMotion={reducedMotion}
        reactiveRef={reactiveRef}
        fragment={shader}
      />
    ) : null;
  }
  if (assetUrl === null) {
    return null;
  }
  if (background.background_type === 'image') {
    return (
      <img
        aria-hidden="true"
        alt=""
        className={SURFACE_CLASS}
        src={assetUrl}
        draggable={false}
        onLoad={imageLoaded}
        onError={mediaError}
      />
    );
  }
  return (
    <CustomVideo src={assetUrl} name={background.name} playing={isPlaying && !reducedMotion} />
  );
}

export function CustomBackground({ background, isPlaying, reactiveRef }: CustomBackgroundProps) {
  const [assetUrl, setAssetUrl] = useState<string | null>(null);
  const [shader, setShader] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const { failed } = useBackgroundLifecycle();

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      if (background.background_type === 'shader') {
        const source = await loadCustomShaderSource(background, controller.signal);
        const shaderError = validateCustomShader(source);
        if (shaderError !== undefined) {
          throw new Error(t('playback.background.shaderCompileError', { error: shaderError }));
        }
        if (!controller.signal.aborted) {
          setShader(customFragmentShader(source));
        }
        return;
      }
      const url = await resolveCustomBackgroundUrl(background);
      if (!controller.signal.aborted) {
        setAssetUrl(url);
      }
    };

    void load().catch((error: unknown) => {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : 'Background could not be loaded';
        failed(message);
      }
    });

    return () => controller.abort();
  }, [background, failed]);

  return (
    <BackgroundSurface
      background={background}
      isPlaying={isPlaying}
      reactiveRef={reactiveRef}
      reducedMotion={reducedMotion}
      shader={shader}
      assetUrl={assetUrl}
    />
  );
}
