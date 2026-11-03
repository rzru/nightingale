import { type KeyboardEvent, type Ref } from 'react';

import { t, tp } from '@/i18n';
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
        placeholder={t(
          loadingInitial ? 'lyrics.editor.loadingPlaceholder' : 'lyrics.editor.placeholder',
        )}
        disabled={disabled}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto bg-card font-mono whitespace-pre [field-sizing:fixed]',
          NO_FOCUS_RING_CLASS,
          focused && RING_CLASS,
        )}
        spellCheck={false}
      />
      <p className="mt-2 text-[11px] text-muted-foreground">
        {tp('lyrics.editor.lineCountOne', 'lyrics.editor.lineCountOther', lineCount)}
        {isDirty ? t('lyrics.editor.unsavedChanges') : ''}
      </p>
      {!hasLrc && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t('lyrics.lyricsEditor.setTimingWithValue1AtDescription', {
            value1: '[mm:ss.xx]',
            value2: '[01:23.45]',
            value3: '<mm:ss.xx>',
          })}
        </p>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        {CJK_PATTERN.test(text) ? (
          <>
            {t('lyrics.lyricsEditor.fixAReadingWithValue1Description', {
              value1: '{漢字|romaji}',
              value2: '{漢字|かな}',
              value3: '{君|kimi}',
              value4: ' ',
              value5: '{彷徨|さまよ}って',
            })}
          </>
        ) : (
          <>
            {t('lyrics.lyricsEditor.addANoteAboveADescription', {
              value1: '{word|note}',
              value2: '{colour|color}',
            })}
          </>
        )}
      </p>
    </>
  );
};
