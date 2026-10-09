import { type KeyboardEvent, type Ref } from 'react';

import { Textarea } from '@/shared/components/ui/textarea';
import { cn } from '@/shared/utils/cn';

import { NO_FOCUS_RING_CLASS, RING_CLASS } from './parts';

const TEXTAREA_ROWS = 16;
const CJK_PATTERN = /[\u3040-\u30ff\u3400-\u9fff]/;

const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.blur();
  }
};

type LyricsEditorProps = {
  textareaRef: Ref<HTMLTextAreaElement>;
  text: string;
  onChange: (text: string) => void;
  disabled: boolean;
  loadingInitial: boolean;
  lineCount: number;
  isDirty: boolean;
  focused: boolean;
  hasLrc: boolean;
};

export const LyricsEditor = ({
  textareaRef,
  text,
  onChange,
  disabled,
  loadingInitial,
  lineCount,
  isDirty,
  focused,
  hasLrc,
}: LyricsEditorProps) => {
  return (
    <>
      <Textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={TEXTAREA_ROWS}
        placeholder={loadingInitial ? 'Loading lyrics…' : 'Enter lyrics, one line per row'}
        disabled={disabled}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto bg-card font-mono whitespace-pre [field-sizing:fixed]',
          NO_FOCUS_RING_CLASS,
          focused && RING_CLASS,
        )}
        spellCheck={false}
      />
      <p className="mt-2 text-[11px] text-muted-foreground">
        {lineCount} {lineCount === 1 ? 'line' : 'lines'}
        {isDirty ? ' • unsaved changes' : ''}
      </p>
      {!hasLrc && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Set timing with {'[mm:ss.xx]'} at the start of a line ({'[01:23.45]'} = 1 min 23.45 s),
          and {'<mm:ss.xx>'} before a word for word timing
        </p>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        {CJK_PATTERN.test(text) ? (
          <>
            Fix a reading with {'{漢字|romaji}'} or {'{漢字|かな}'}, e.g. {'{君|kimi}'} or{' '}
            {'{彷徨|さまよ}って'}
          </>
        ) : (
          <>
            Add a note above a word with {'{word|note}'}, e.g. {'{colour|color}'}
          </>
        )}
      </p>
    </>
  );
};
