import { useEffect, useRef, useState } from 'react';

import {
  type PitchGraphNotes,
  pitchNoteIndex,
  renderPitchGraph,
} from '@/features/playback/components/pitch-graph-canvas';
import { clampPlaybackScale } from '@/features/playback/lib/display-scale';
import type { PitchSeries } from '@/features/playback/lib/pitch/state';
import { usePlaybackMicState } from '@/features/playback/providers';
import { playerColorOption } from '@/shared/player-colors';

type StableNoteState = {
  displayed: number | null;
  candidate: number | null;
  candidateSince: number;
  lastSeen: number;
  lastUpdate: number;
};

const NOTE_STABILITY_SECONDS = 0.18;
const NOTE_HOLD_SECONDS = 0.25;

function newStableNoteState(): StableNoteState {
  return {
    displayed: null,
    candidate: null,
    candidateSince: 0,
    lastSeen: 0,
    lastUpdate: 0,
  };
}

function updateStableNote(state: StableNoteState, hz: number | null, time: number): number | null {
  if (time < state.lastUpdate) {
    Object.assign(state, newStableNoteState());
  }
  state.lastUpdate = time;

  if (hz === null) {
    state.candidate = null;
    if (time - state.lastSeen > NOTE_HOLD_SECONDS) {
      state.displayed = null;
    }
    return state.displayed;
  }

  const note = pitchNoteIndex(hz);
  state.lastSeen = time;
  if (note === state.displayed) {
    state.candidate = null;
    return state.displayed;
  }
  if (note !== state.candidate) {
    state.candidate = note;
    state.candidateSince = time;
    return state.displayed;
  }
  if (time - state.candidateSince >= NOTE_STABILITY_SECONDS) {
    state.displayed = note;
    state.candidate = null;
  }

  return state.displayed;
}

function stableNote(
  states: Map<string, StableNoteState>,
  key: string,
  hz: number | null | undefined,
  time: number,
): number | null {
  const state = states.get(key) ?? newStableNoteState();
  states.set(key, state);

  return updateStableNote(state, hz ?? null, time);
}

function useWindowSize(): { height: number; width: number } {
  const [size, setSize] = useState(() => ({
    height: window.innerHeight,
    width: window.innerWidth,
  }));

  useEffect(() => {
    const onResize = () => setSize({ height: window.innerHeight, width: window.innerWidth });

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return size;
}

type PlaybackMicPlayers = ReturnType<typeof usePlaybackMicState>['players'];

function currentNotes(
  multiplayer: boolean,
  players: PlaybackMicPlayers,
  series: PitchSeries,
  states: Map<string, StableNoteState>,
): PitchGraphNotes {
  const activePlayers = multiplayer ? players.filter((player) => player.micReady) : [];
  const referenceSeries = activePlayers[0]?.series ?? series;
  const time = referenceSeries.currentTime;
  const reference = stableNote(states, 'reference', referenceSeries.refPitches.at(-1), time);

  if (!multiplayer) {
    const note = stableNote(states, 'singer-0', series.userPitches.at(-1), time);
    return { reference, singers: note === null ? [] : [{ note }] };
  }

  return {
    reference,
    singers: activePlayers.flatMap((player, index) => {
      const note = stableNote(states, `singer-${index}`, player.series.userPitches.at(-1), time);
      return note === null ? [] : [{ note, color: playerColorOption(player.color).rgb }];
    }),
  };
}

type PitchGraphProps = {
  series: PitchSeries;
  position?: 'top' | 'bottom';
  scale?: number | null;
};

export function PitchGraph({ series, position = 'top', scale = 1 }: PitchGraphProps) {
  const { micReady, multiplayer, players } = usePlaybackMicState();
  const visible = multiplayer ? players.some((player) => player.micReady) : micReady;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stableNotesRef = useRef(new Map<string, StableNoteState>());
  const { height: windowHeight, width: windowWidth } = useWindowSize();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!visible || !canvas) {
      return;
    }

    renderPitchGraph({
      canvas,
      windowHeight,
      windowWidth,
      scale: clampPlaybackScale(scale),
      series,
      players: multiplayer
        ? players
            .filter((player) => player.micReady)
            .map((player) => ({
              series: player.series,
              color: playerColorOption(player.color).rgb,
            }))
        : [],
      notes: currentNotes(multiplayer, players, series, stableNotesRef.current),
    });
  }, [multiplayer, players, series, visible, windowHeight, windowWidth, scale]);

  if (!visible) {
    return null;
  }

  const positionClass = position === 'bottom' ? 'bottom-2 sm:bottom-3' : 'top-2 sm:top-3';

  return (
    <div
      className={`pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 rounded-sm border-white/15 bg-black/40 p-1 ${positionClass}`}
    >
      <canvas ref={canvasRef} className="block" aria-hidden="true" />
    </div>
  );
}
