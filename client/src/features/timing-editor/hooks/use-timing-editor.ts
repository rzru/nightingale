import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { loadBaseTranscript, saveTranscriptEdits } from '@/bridge/timing-editor';
import {
  addWordAfter,
  commit,
  deleteWord,
  docFromSegments,
  mergeLineWithNext,
  mergeWithNext,
  newHistory,
  nextWordRef,
  redo,
  segmentsFromDoc,
  setWordText,
  setWordTimes,
  shiftAllBy,
  shiftLineBy,
  shiftWordBy,
  splitLine,
  splitWord,
  tapEnd,
  tapWord,
  toggleNoSing,
  undo,
  wordAt,
  type EditorDoc,
  type History,
  type WordRef,
} from '@/features/timing-editor/lib/model';
import { t } from '@/i18n';
import { LYRICS, SCORE_NOTES, SONG_RANGE } from '@/shared/query-keys';

const EMPTY_DOC: EditorDoc = { lines: [], nextId: 0 };

const errorText = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** Keep the selection on an existing word after an edit changed the lines. */
function clampSelection(doc: EditorDoc, ref: WordRef | null): WordRef | null {
  if (ref === null || doc.lines.length === 0) {
    return null;
  }
  const line = Math.min(ref.line, doc.lines.length - 1);
  const words = doc.lines[line].words.length;
  return { line, word: Math.min(ref.word, Math.max(0, words - 1)) };
}

/** Where to cut a word in two: at its first space, else in the middle. */
const splitPoint = (text: string): number => {
  const space = text.indexOf(' ');
  return space > 0 ? space : Math.floor(text.length / 2);
};

/** State of the timing editor: the document, its history and the selection. */
export function useTimingEditor(fileHash: string) {
  const queryClient = useQueryClient();
  const [history, setHistory] = useState<History>(() => newHistory(EMPTY_DOC));
  const [savedDoc, setSavedDoc] = useState<EditorDoc>(EMPTY_DOC);
  const [preview, setPreview] = useState<EditorDoc | null>(null);
  const [selection, setSelection] = useState<WordRef | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadBaseTranscript(fileHash)
      .then((transcript) => {
        if (cancelled) {
          return undefined;
        }
        const doc = docFromSegments(transcript.segments);
        setHistory(newHistory(doc));
        setSavedDoc(doc);
        setSelection(doc.lines.length > 0 ? { line: 0, word: 0 } : null);
        setLoading(false);
        return undefined;
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLoadError(errorText(cause));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fileHash]);

  const doc = preview ?? history.present;
  const dirty = history.present !== savedDoc;

  /** Apply an edit to the current document as one undo step. */
  const apply = useCallback((edit: (current: EditorDoc) => EditorDoc) => {
    setPreview(null);
    setHistory((current) => {
      const next = commit(current, edit(current.present));
      setSelection((ref) => clampSelection(next.present, ref));
      return next;
    });
  }, []);

  const undoEdit = useCallback(() => {
    setPreview(null);
    setHistory((current) => {
      const next = undo(current);
      setSelection((ref) => clampSelection(next.present, ref));
      return next;
    });
  }, []);

  const redoEdit = useCallback(() => {
    setPreview(null);
    setHistory((current) => {
      const next = redo(current);
      setSelection((ref) => clampSelection(next.present, ref));
      return next;
    });
  }, []);

  /** Drag in progress: show the result without recording an undo step. */
  const previewTimes = useCallback(
    (ref: WordRef, start: number, end: number) => {
      setPreview(setWordTimes(history.present, ref, start, end));
    },
    [history.present],
  );

  /** One tap in tap-timing mode; returns false when there is nothing to tap. */
  const tap = useCallback(
    (time: number): boolean => {
      if (selection === null || wordAt(history.present, selection) === undefined) {
        return false;
      }
      apply((current) => tapWord(current, selection, time));
      const next = nextWordRef(history.present, selection);
      if (next !== null) {
        setSelection(next);
      }
      return true;
    },
    [apply, history.present, selection],
  );

  const tapRelease = useCallback(
    (time: number) => {
      if (selection !== null) {
        apply((current) => tapEnd(current, selection, time));
      }
    },
    [apply, selection],
  );

  const save = useCallback(async () => {
    const toSave = history.present;
    setSaving(true);
    try {
      await saveTranscriptEdits(fileHash, segmentsFromDoc(toSave));
      setSavedDoc(toSave);
      toast.success(t('timingEditor.saved'));
      await Promise.all(
        [SONG_RANGE, SCORE_NOTES, LYRICS].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
    } catch (cause) {
      toast.error(t('timingEditor.saveError', { error: errorText(cause) }));
    } finally {
      setSaving(false);
    }
  }, [fileHash, history.present, queryClient]);

  const edits = useMemo(() => {
    const onSelected = (edit: (current: EditorDoc, ref: WordRef) => EditorDoc) => () => {
      if (selection !== null) {
        apply((current) => edit(current, selection));
      }
    };
    return {
      setText: (text: string) => onSelected((current, ref) => setWordText(current, ref, text))(),
      setTimes: (start: number, end: number) =>
        onSelected((current, ref) => setWordTimes(current, ref, start, end))(),
      toggleNoSing: onSelected(toggleNoSing),
      split: onSelected((current, ref) =>
        splitWord(current, ref, splitPoint(wordAt(current, ref)?.text ?? '')),
      ),
      mergeNext: onSelected(mergeWithNext),
      addAfter: onSelected((current, ref) => addWordAfter(current, ref, t('timingEditor.newWord'))),
      remove: onSelected(deleteWord),
      splitLine: onSelected(splitLine),
      mergeLine: onSelected((current, ref) => mergeLineWithNext(current, ref.line)),
      shiftWord: (delta: number) =>
        onSelected((current, ref) => shiftWordBy(current, ref, delta))(),
      shiftLine: (delta: number) =>
        onSelected((current, ref) => shiftLineBy(current, ref.line, delta))(),
      shiftAll: (delta: number) => apply((current) => shiftAllBy(current, delta)),
    };
  }, [apply, selection]);

  return {
    doc,
    loading,
    loadError,
    saving,
    dirty,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    selection,
    setSelection,
    apply,
    previewTimes,
    undo: undoEdit,
    redo: redoEdit,
    tap,
    tapRelease,
    save,
    edits,
  };
}

export type TimingEditorState = ReturnType<typeof useTimingEditor>;
