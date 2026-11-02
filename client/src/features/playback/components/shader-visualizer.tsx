import { Canvas } from '@react-three/fiber';

import type { MicReactiveRef } from '@/features/microphone/hooks/use-mic-reactive';
import { useReactiveShaderUniforms } from '@/features/playback/hooks/use-reactive-shader-uniforms';

import { shaders, vertexShader } from './shaders';

type ShaderVisualizerProps = {
  shaderIndex: number;
  isPlaying: boolean;
  customFragment?: string;
  reactiveRef?: MicReactiveRef;
  className?: string;
  onReady?: () => void;
};

const ShaderQuad = ({
  shaderIndex,
  isPlaying,
  customFragment,
  reactiveRef,
}: ShaderVisualizerProps) => {
  const fragmentShader = customFragment ?? shaders[shaderIndex].fragmentShader;
  const uniforms = useReactiveShaderUniforms(reactiveRef, isPlaying);

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        key={typeof customFragment === 'string' && customFragment !== '' ? 'custom' : shaderIndex}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
      />
    </mesh>
  );
};

export const ShaderVisualizer = ({
  className = 'fixed inset-0',
  onReady,
  ...props
}: ShaderVisualizerProps) => (
  <div className={className}>
    <Canvas flat dpr={1} onCreated={() => requestAnimationFrame(() => onReady?.())}>
      <ShaderQuad {...props} />
    </Canvas>
  </div>
);
