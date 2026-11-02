import { useEffect, useMemo, useRef, useState } from 'react';

import type { MicReactiveRef } from '@/features/microphone/hooks/use-mic-reactive';
import {
  buildPitchGuideTrack,
  renderPitchGuide,
  renderPitchGuideLanes,
  type PitchGuidePlayer,
  type PitchGuideTrack,
} from '@/features/playback/components/pitch-guide-canvas';
import type { PitchSeries } from '@/features/playback/lib/pitch/state';
import { usePlaybackMicState } from '@/features/playback/providers/playback-mic-context';
import { playerColorOption } from '@/shared/player-colors';

import { ShaderVisualizer } from './shader-visualizer';

type PitchGuideBackgroundProps = {
  shaderIndex: number;
  isPlaying: boolean;
  reactiveRef: MicReactiveRef;
};

type PitchGuideFrame = {
  width: number;
  height: number;
  track: PitchGuideTrack;
  series: PitchSeries;
  players: PitchGuidePlayer[];
  isPlaying: boolean;
  capturedAt: number;
};

function advanceSeries(series: PitchSeries, elapsed: number): PitchSeries {
  return {
    ...series,
    referenceTime: series.referenceTime + elapsed,
    currentTime: series.currentTime + elapsed,
  };
}

function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return size;
}

export function PitchGuideBackground({
  shaderIndex,
  isPlaying,
  reactiveRef,
}: PitchGuideBackgroundProps) {
  const { multiplayer, players, series } = usePlaybackMicState();
  const lanesCanvasRef = useRef<HTMLCanvasElement>(null);
  const guideCanvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<PitchGuideFrame | null>(null);
  const needsDrawRef = useRef(true);
  const { width, height } = useWindowSize();
  const guideTrack = useMemo(
    () => buildPitchGuideTrack(series.referenceTrack),
    [series.referenceTrack],
  );
  const guidePlayers = useMemo<PitchGuidePlayer[]>(
    () =>
      multiplayer
        ? players
            .filter((player) => player.micReady)
            .map((player) => ({
              series: player.series,
              color: playerColorOption(player.color).rgb,
            }))
        : [],
    [multiplayer, players],
  );

  useEffect(() => {
    const canvas = lanesCanvasRef.current;
    if (canvas) {
      renderPitchGuideLanes({ canvas, width, height, track: guideTrack });
    }
  }, [guideTrack, height, width]);

  useEffect(() => {
    frameRef.current = {
      width,
      height,
      track: guideTrack,
      series,
      players: guidePlayers,
      isPlaying,
      capturedAt: performance.now(),
    };
    needsDrawRef.current = true;
  }, [guidePlayers, guideTrack, height, isPlaying, series, width]);

  useEffect(() => {
    let animationFrame = 0;

    const draw = (now: number) => {
      const canvas = guideCanvasRef.current;
      const frame = frameRef.current;

      if (canvas && frame && (frame.isPlaying || needsDrawRef.current)) {
        const elapsed = frame.isPlaying ? Math.max(0, (now - frame.capturedAt) / 1000) : 0;
        renderPitchGuide({
          canvas,
          width: frame.width,
          height: frame.height,
          track: frame.track,
          series: advanceSeries(frame.series, elapsed),
          players: frame.players.map((player) => ({
            series: advanceSeries(player.series, elapsed),
            color: player.color,
          })),
        });
        needsDrawRef.current = false;
      }

      animationFrame = requestAnimationFrame(draw);
    };

    animationFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  return (
    <div className="fixed inset-0">
      <ShaderVisualizer
        shaderIndex={shaderIndex}
        isPlaying={isPlaying}
        reactiveRef={reactiveRef}
        className="absolute inset-0"
      />
      <canvas
        ref={lanesCanvasRef}
        className="pointer-events-none absolute inset-0 block"
        aria-hidden
      />
      <canvas
        ref={guideCanvasRef}
        className="pointer-events-none absolute inset-0 block"
        aria-hidden
      />
    </div>
  );
}
