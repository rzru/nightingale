import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { LineStrip } from '@/features/timing-editor/components/line-strip';
import { WordInspector } from '@/features/timing-editor/components/word-inspector';
import {
  useEditorAudio,
  type EditorAudio,
  type EditorTrack,
} from '@/features/timing-editor/hooks/use-editor-audio';
import {
  useTimingEditor,
  type TimingEditorState,
} from '@/features/timing-editor/hooks/use-timing-editor';
import {
  lineBounds,
  setWordTimes,
  wordAt,
  type EditorDoc,
  type WordRef,
} from '@/features/timing-editor/lib/model';
import { playheadInLine } from '@/features/timing-editor/lib/strip-geometry';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/utils/cn';

const RATES = [1, 0.75, 0.5];
const TRACKS: EditorTrack[] = ['all', 'vocals', 'music'];
const LOOP_MARGIN_SEC = 0.4;
const NUDGE_SEC = 0.01;

const trackLabel = (track: EditorTrack): string => {
  if (track === 'vocals') {
    return t('timingEditor.trackVocals');
  }
  return track === 'music' ? t('timingEditor.trackMusic') : t('timingEditor.trackAll');
};

const formatTime = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, '0')}`;
};

type SelectionStep = 'prev' | 'next' | 'up' | 'down';

function moveByLine(doc: EditorDoc, ref: WordRef, delta: number): WordRef {
  const line = Math.min(doc.lines.length - 1, Math.max(0, ref.line + delta));
  return { line, word: Math.min(ref.word, doc.lines[line].words.length - 1) };
}

function moveByWord(doc: EditorDoc, ref: WordRef, delta: number): WordRef {
  const word = ref.word + delta;
  if (word >= 0 && word < doc.lines[ref.line].words.length) {
    return { line: ref.line, word };
  }
  const line = ref.line + delta;
  if (line < 0 || line >= doc.lines.length) {
    return ref;
  }
  return { line, word: delta < 0 ? doc.lines[line].words.length - 1 : 0 };
}

/** Move the selection by words (within and across lines) or by lines. */
function moveSelection(doc: EditorDoc, ref: WordRef | null, step: SelectionStep): WordRef | null {
  if (doc.lines.length === 0) {
    return null;
  }
  if (ref === null) {
    return { line: 0, word: 0 };
  }
  if (step === 'up' || step === 'down') {
    return moveByLine(doc, ref, step === 'up' ? -1 : 1);
  }
  return moveByWord(doc, ref, step === 'prev' ? -1 : 1);
}

type KeyContext = {
  editor: TimingEditorState;
  audio: EditorAudio;
  tapMode: boolean;
  toggleTapMode: () => void;
  toggleLoop: () => void;
};

/** Nudge the start (or with Shift the end) of the selected word. */
function nudge({ editor }: KeyContext, event: KeyboardEvent, delta: number): void {
  const word = editor.selection === null ? undefined : wordAt(editor.doc, editor.selection);
  if (word === undefined) {
    return;
  }
  if (event.shiftKey) {
    editor.edits.setTimes(word.start, word.end + delta);
  } else {
    editor.edits.setTimes(word.start + delta, word.end);
  }
}

const select = (context: KeyContext, step: SelectionStep) =>
  context.editor.setSelection(moveSelection(context.editor.doc, context.editor.selection, step));

// Keys by `event.code`, so they work on any keyboard layout.
type KeyAction = (context: KeyContext, event: KeyboardEvent) => void;

const KEY_ACTIONS = new Map<string, KeyAction>(
  Object.entries({
    Space: (context) => {
      if (context.tapMode) {
        context.editor.tap(context.audio.now());
      } else {
        context.audio.toggle();
      }
    },
    Enter: (context) => context.audio.toggle(),
    ArrowLeft: (context) => select(context, 'prev'),
    ArrowRight: (context) => select(context, 'next'),
    ArrowUp: (context) => select(context, 'up'),
    ArrowDown: (context) => select(context, 'down'),
    BracketLeft: (context, event) => nudge(context, event, -NUDGE_SEC),
    BracketRight: (context, event) => nudge(context, event, NUDGE_SEC),
    KeyT: (context) => context.toggleTapMode(),
    KeyL: (context) => context.toggleLoop(),
    KeyN: (context) => context.editor.edits.toggleNoSing(),
    Delete: (context: KeyContext) => context.editor.edits.remove(),
  }),
);

const CTRL_KEY_ACTIONS = new Map<string, KeyAction>(
  Object.entries({
    KeyZ: (context, event) => (event.shiftKey ? context.editor.redo() : context.editor.undo()),
    KeyY: (context) => context.editor.redo(),
    KeyS: (context: KeyContext) => void context.editor.save(),
  }),
);

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

function useEditorKeys(context: KeyContext): void {
  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const ctrl = event.ctrlKey || event.metaKey;
      const action = (ctrl ? CTRL_KEY_ACTIONS : KEY_ACTIONS).get(event.code);
      // Typing in a field keeps its keys, except the Ctrl shortcuts.
      if (action === undefined || (!ctrl && isTyping(event.target))) {
        return;
      }
      event.preventDefault();
      action(contextRef.current, event);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const current = contextRef.current;
      if (event.code === 'Space' && current.tapMode && !isTyping(event.target)) {
        current.editor.tapRelease(current.audio.now());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);
}

type ToolbarProps = {
  title: string;
  editor: TimingEditorState;
  audio: EditorAudio;
  tapMode: boolean;
  loop: boolean;
  onToggleTapMode: () => void;
  onToggleLoop: () => void;
  onBack: () => void;
};

function Toolbar({
  title,
  editor,
  audio,
  tapMode,
  loop,
  onToggleTapMode,
  onToggleLoop,
  onBack,
}: ToolbarProps) {
  return (
    <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
      <Button variant="ghost" onClick={onBack}>
        {t('common.actions.back')}
      </Button>
      <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">
        {t('timingEditor.title', { title })}
      </h1>
      <span className="text-xs text-muted-foreground tabular-nums">
        {formatTime(audio.time)} / {formatTime(audio.duration)}
      </span>
      <Button variant="outline" disabled={!audio.ready} onClick={audio.toggle}>
        {audio.playing ? t('common.actions.pause') : t('common.actions.play')}
      </Button>
      {TRACKS.map((track) => (
        <Button
          key={track}
          size="sm"
          variant={audio.track === track ? 'default' : 'outline'}
          aria-pressed={audio.track === track}
          disabled={!audio.hasVocals && track !== 'all'}
          onClick={() => audio.setTrack(track)}
        >
          {trackLabel(track)}
        </Button>
      ))}
      {RATES.map((rate) => (
        <Button
          key={rate}
          size="sm"
          variant={audio.rate === rate ? 'default' : 'outline'}
          aria-pressed={audio.rate === rate}
          onClick={() => audio.setRate(rate)}
        >
          {Math.round(rate * 100)}%
        </Button>
      ))}
      <Button
        size="sm"
        variant={loop ? 'default' : 'outline'}
        aria-pressed={loop}
        onClick={onToggleLoop}
      >
        {t('timingEditor.loopLine')}
      </Button>
      <Button
        size="sm"
        variant={tapMode ? 'default' : 'outline'}
        aria-pressed={tapMode}
        onClick={onToggleTapMode}
      >
        {t('timingEditor.tapMode')}
      </Button>
      <Button size="sm" variant="outline" disabled={!editor.canUndo} onClick={editor.undo}>
        {t('timingEditor.undo')}
      </Button>
      <Button size="sm" variant="outline" disabled={!editor.canRedo} onClick={editor.redo}>
        {t('timingEditor.redo')}
      </Button>
      <Button disabled={!editor.dirty || editor.saving} onClick={() => void editor.save()}>
        {editor.saving ? t('timingEditor.saving') : t('timingEditor.save')}
      </Button>
    </header>
  );
}

function Notice({ children, tone = 'muted' }: { children: string; tone?: 'muted' | 'warning' }) {
  return (
    <p
      className={cn(
        'border-b px-4 py-1.5 text-xs',
        tone === 'warning'
          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
          : 'text-muted-foreground',
      )}
    >
      {children}
    </p>
  );
}

type LinesProps = {
  editor: TimingEditorState;
  audio: EditorAudio;
};

function Lines({ editor, audio }: LinesProps) {
  const { doc, selection, setSelection, previewTimes, apply } = editor;
  const seek = audio.seek;

  const onTimesChange = useCallback(
    (change: { ref: WordRef; start: number; end: number; final: boolean }) => {
      if (change.final) {
        apply((current) => setWordTimes(current, change.ref, change.start, change.end));
      } else {
        previewTimes(change.ref, change.start, change.end);
      }
    },
    [apply, previewTimes],
  );

  return (
    <ol className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      {doc.lines.map((line, li) => (
        <li
          key={line.id}
          className={cn(
            'flex flex-col gap-1',
            selection?.line === li && 'rounded-md bg-accent/40 p-1',
          )}
        >
          <span className="text-xs text-muted-foreground tabular-nums">
            {li + 1} · {formatTime(lineBounds(line).start)}
          </span>
          <LineStrip
            line={line}
            lineIndex={li}
            selectedWord={selection?.line === li ? selection.word : null}
            peaks={audio.peaks}
            playhead={playheadInLine(line, audio.time) ? audio.time : null}
            onSelect={setSelection}
            onSeek={seek}
            onTimesChange={onTimesChange}
          />
        </li>
      ))}
    </ol>
  );
}

function LeaveConfirm({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  return (
    <div className="flex items-center gap-3 border-b bg-amber-500/15 px-4 py-2 text-sm">
      <span className="flex-1">{t('timingEditor.unsavedWarning')}</span>
      <Button size="sm" variant="outline" onClick={onStay}>
        {t('timingEditor.keepEditing')}
      </Button>
      <Button size="sm" variant="destructive" onClick={onLeave}>
        {t('timingEditor.discard')}
      </Button>
    </div>
  );
}

function EditorScreen({ fileHash, title }: { fileHash: string; title: string }) {
  const navigate = useNavigate();
  const editor = useTimingEditor(fileHash);
  const audio = useEditorAudio(fileHash);
  const [tapMode, setTapMode] = useState(false);
  const [loop, setLoop] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const { doc, selection } = editor;
  const setAudioLoop = audio.setLoop;

  // The loop follows the selected line.
  useEffect(() => {
    const line = loop && selection !== null ? doc.lines.at(selection.line) : undefined;
    if (line === undefined) {
      setAudioLoop(null);
      return;
    }
    const bounds = lineBounds(line);
    setAudioLoop({
      start: Math.max(0, bounds.start - LOOP_MARGIN_SEC),
      end: bounds.end + LOOP_MARGIN_SEC,
    });
  }, [doc, loop, selection, setAudioLoop]);

  const toggleTapMode = useCallback(() => setTapMode((value) => !value), []);
  const toggleLoop = useCallback(() => setLoop((value) => !value), []);
  useEditorKeys({ editor, audio, tapMode, toggleTapMode, toggleLoop });

  const leave = () => void navigate('/');
  const onBack = () => (editor.dirty ? setConfirmLeave(true) : leave());

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <Toolbar
        title={title}
        editor={editor}
        audio={audio}
        tapMode={tapMode}
        loop={loop}
        onToggleTapMode={toggleTapMode}
        onToggleLoop={toggleLoop}
        onBack={onBack}
      />
      {confirmLeave ? <LeaveConfirm onStay={() => setConfirmLeave(false)} onLeave={leave} /> : null}
      <Notice>{tapMode ? t('timingEditor.tapHint') : t('timingEditor.keysHint')}</Notice>
      {editor.loadError === null ? null : <Notice tone="warning">{editor.loadError}</Notice>}
      {audio.error === null ? null : (
        <Notice tone="warning">{t('timingEditor.audioError', { error: audio.error })}</Notice>
      )}
      <div className="flex min-h-0 flex-1">
        {editor.loading ? (
          <p className="flex-1 p-4 text-sm text-muted-foreground">{t('common.loading')}…</p>
        ) : (
          <Lines editor={editor} audio={audio} />
        )}
        <WordInspector
          word={selection === null ? null : (wordAt(doc, selection) ?? null)}
          actions={editor.edits}
        />
      </div>
    </div>
  );
}

/** Full-screen visual editor of lyrics and word timing; opened from a song's actions. */
export function TimingEditorPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fileHash = params.get('hash');
  const title = params.get('title') ?? '';
  const tempo = Number(params.get('tempo') ?? '1');

  if (fileHash === null || fileHash === '' || tempo !== 1) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
        <p className="max-w-md text-sm">
          {tempo === 1 ? t('timingEditor.noSong') : t('timingEditor.resetTempoFirst')}
        </p>
        <Button onClick={() => void navigate('/')}>{t('common.actions.back')}</Button>
      </div>
    );
  }

  return <EditorScreen fileHash={fileHash} title={title} />;
}
