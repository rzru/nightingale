import type { EditorWord } from '@/features/timing-editor/lib/model';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';

export type InspectorActions = {
  setText: (text: string) => void;
  setTimes: (start: number, end: number) => void;
  toggleNoSing: () => void;
  split: () => void;
  mergeNext: () => void;
  addAfter: () => void;
  remove: () => void;
  splitLine: () => void;
  mergeLine: () => void;
  shiftWord: (deltaSec: number) => void;
  shiftLine: (deltaSec: number) => void;
  shiftAll: (deltaSec: number) => void;
};

type Props = {
  word: EditorWord | null;
  actions: InspectorActions;
};

const STEP_SEC = 0.05;

const parseTime = (value: string, fallback: number): number => {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

function ShiftButtons({ label, onShift }: { label: string; onShift: (deltaSec: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <Button
        size="sm"
        variant="outline"
        aria-label={t('timingEditor.shiftEarlier', { label })}
        onClick={() => onShift(-STEP_SEC)}
      >
        −50
      </Button>
      <Button
        size="sm"
        variant="outline"
        aria-label={t('timingEditor.shiftLater', { label })}
        onClick={() => onShift(STEP_SEC)}
      >
        +50
      </Button>
    </div>
  );
}

/** Text, times and structure of the selected word. */
export function WordInspector({ word, actions }: Props) {
  if (word === null) {
    return (
      <aside className="w-72 shrink-0 border-l p-4 text-sm text-muted-foreground">
        {t('timingEditor.selectWordHint')}
      </aside>
    );
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l p-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="timing-editor-word-text">{t('timingEditor.wordText')}</Label>
        <Input
          id="timing-editor-word-text"
          value={word.text}
          onChange={(event) => actions.setText(event.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="timing-editor-word-start">{t('timingEditor.wordStart')}</Label>
          <Input
            id="timing-editor-word-start"
            inputMode="decimal"
            // Remount when another word or an edit changes the stored value.
            key={`start-${word.start}`}
            defaultValue={word.start.toFixed(3)}
            onBlur={(event) =>
              actions.setTimes(parseTime(event.target.value, word.start), word.end)
            }
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="timing-editor-word-end">{t('timingEditor.wordEnd')}</Label>
          <Input
            id="timing-editor-word-end"
            inputMode="decimal"
            key={`end-${word.end}`}
            defaultValue={word.end.toFixed(3)}
            onBlur={(event) =>
              actions.setTimes(word.start, parseTime(event.target.value, word.end))
            }
          />
        </div>
      </div>

      <Button
        variant={word.noSing === true ? 'default' : 'outline'}
        aria-pressed={word.noSing === true}
        onClick={actions.toggleNoSing}
      >
        {t('timingEditor.noSing')}
      </Button>
      <p className="text-xs text-muted-foreground">{t('timingEditor.noSingHint')}</p>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={actions.split}>
          {t('timingEditor.splitWord')}
        </Button>
        <Button variant="outline" onClick={actions.mergeNext}>
          {t('timingEditor.mergeWord')}
        </Button>
        <Button variant="outline" onClick={actions.addAfter}>
          {t('timingEditor.addWord')}
        </Button>
        <Button variant="outline" onClick={actions.remove}>
          {t('timingEditor.deleteWord')}
        </Button>
        <Button variant="outline" onClick={actions.splitLine}>
          {t('timingEditor.splitLine')}
        </Button>
        <Button variant="outline" onClick={actions.mergeLine}>
          {t('timingEditor.mergeLine')}
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium">{t('timingEditor.shiftTitle')}</p>
        <ShiftButtons label={t('timingEditor.shiftWord')} onShift={actions.shiftWord} />
        <ShiftButtons label={t('timingEditor.shiftLine')} onShift={actions.shiftLine} />
        <ShiftButtons label={t('timingEditor.shiftAll')} onShift={actions.shiftAll} />
      </div>
    </aside>
  );
}
