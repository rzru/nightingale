import { useMemo, useState } from 'react';

import { useSaveLyricsMutation } from '@/features/lyrics/mutations/use-save-lyrics-mutation';
import { useInitialLyrics, useSidecarLrc } from '@/features/lyrics/queries/use-lyrics';
import { normalizeLines } from '@/features/lyrics/utils/edit-lyrics';
import type { SidecarLrc } from '@/types/SidecarLrc';
import type { Song } from '@/types/Song';

export type UseLyricsEditorArgs = {
  song: Song | null;
  onSaved: () => void;
};

export type LyricsEditorState = {
  text: string;
  setText: (text: string) => void;
  loadingInitial: boolean;
  saving: boolean;
  normalized: string[];
  isDirty: boolean;
  canSave: boolean;
  handleSave: () => Promise<void>;
  sidecar: SidecarLrc | null;
  showingSidecar: boolean;
  canUseSidecar: boolean;
  applySidecar: () => void;
};

const fileHashOf = (song: Song | null): string | null => song?.file_hash ?? null;

const hasText = (text: string): boolean => text.trim().length > 0;

type SidecarStateInput = {
  hasCached: boolean;
  sidecarText: string;
  loadedText: string;
  text: string;
  override: string | null;
};

// Pre-filled sidecar text is unsaved content, so it counts as dirty.
const resolveSidecarState = (input: SidecarStateInput) => {
  const { hasCached, sidecarText, loadedText, text, override } = input;
  const autoApplied = !hasCached && sidecarText.length > 0;
  const showingSidecar = sidecarText.length > 0 && text === sidecarText;
  return {
    isDirty: (override !== null && override !== loadedText) || autoApplied,
    showingSidecar,
    canUseSidecar: sidecarText.length > 0 && !showingSidecar,
  };
};

type SaveGateInput = {
  saving: boolean;
  lyricsLoading: boolean;
  sidecarLoading: boolean;
  hasCached: boolean;
  lineCount: number;
  isDirty: boolean;
};

// Don't flash an empty textarea while the sidecar read resolves, but don't
// block the common cached-lyrics case on it either.
const resolveSaveGate = (input: SaveGateInput) => {
  const loadingInitial = input.lyricsLoading || (!input.hasCached && input.sidecarLoading);
  return {
    loadingInitial,
    canSave: !input.saving && !loadingInitial && input.lineCount > 0 && input.isDirty,
  };
};

export function useLyricsEditor({ song, onSaved }: UseLyricsEditorArgs): LyricsEditorState {
  const fileHash = fileHashOf(song);

  const lyricsQuery = useInitialLyrics(fileHash);
  const sidecarQuery = useSidecarLrc(fileHash);

  // `override` is the user-edited buffer; null means "show the loaded value".
  // Resetting it on song change follows the React-recommended "store previous
  // prop, reset during render" pattern, which avoids the extra-render flicker
  // of a useEffect.
  const [override, setOverride] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(fileHash);

  if (lastHash !== fileHash) {
    setLastHash(fileHash);
    setOverride(null);
  }

  // A sidecar .lrc only pre-fills an otherwise empty editor; cached lyrics or
  // a transcript always win, and the user can still opt in via `applySidecar`.
  const sidecar = sidecarQuery.data ?? null;
  const sidecarText = sidecar?.text ?? '';
  const cachedText = lyricsQuery.data ?? '';
  const hasCached = hasText(cachedText);
  const loadedText = hasCached ? cachedText : sidecarText;
  const text = override ?? loadedText;
  const normalized = useMemo(() => normalizeLines(text), [text]);

  const { isDirty, showingSidecar, canUseSidecar } = resolveSidecarState({
    hasCached,
    sidecarText,
    loadedText,
    text,
    override,
  });
  const applySidecar = () => setOverride(sidecarText);

  const saveMutation = useSaveLyricsMutation();

  const saving = saveMutation.isLoading;
  const { loadingInitial, canSave } = resolveSaveGate({
    saving,
    lyricsLoading: lyricsQuery.isLoading,
    sidecarLoading: sidecarQuery.isLoading,
    hasCached,
    lineCount: normalized.length,
    isDirty,
  });

  const handleSave = async () => {
    if (!canSave || !song) {
      return;
    }
    saveMutation.mutate(
      { hash: song.file_hash, lines: normalized, title: song.title },
      { onSuccess: onSaved },
    );
  };

  return {
    text,
    setText: setOverride,
    loadingInitial,
    saving,
    normalized,
    isDirty,
    canSave,
    handleSave,
    sidecar,
    showingSidecar,
    canUseSidecar,
    applySidecar,
  };
}
