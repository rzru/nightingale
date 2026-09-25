import { Loader2Icon } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';

import { openUrl } from '@/bridge/opener';
import { useLyricsEditor } from '@/features/lyrics/hooks/use-lyrics-editor';
import { useSaveLyricsMutation } from '@/features/lyrics/mutations/use-save-lyrics-mutation';
import {
  useApplyTimedLyricsMutation,
  useProvideLrcMutation,
} from '@/features/lyrics/mutations/use-timed-lyrics-mutation';
import { useLrclibCandidates } from '@/features/lyrics/queries/use-lyrics';
import {
  detectLrcLevel,
  isEditLyricsDialogMode,
  stripLrcToPlainLines,
} from '@/features/lyrics/utils/edit-lyrics';
import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import type { LrclibCandidate } from '@/types/LrclibCandidate';
import type { Song } from '@/types/Song';

import { CarouselNav } from './carousel-nav';
import { EditLyricsFooter } from './edit-lyrics-footer';
import { LrcOptions, type TimingChoice } from './lrc-options';
import { LrclibMatches } from './lrclib-matches';
import { LyricsEditor } from './lyrics-editor';
import { ringFor } from './parts';
import { SidecarLrcNotice } from './sidecar-lrc-notice';

export { isEditLyricsDialogMode } from '@/features/lyrics/utils/edit-lyrics';

const LRC_SPEC_URL = 'https://en.wikipedia.org/wiki/LRC_(file_format)';

type EditLyricsTab = 'edit' | 'lrclib';
const EDIT_LYRICS_TABS = ['edit', 'lrclib'] satisfies readonly EditLyricsTab[];

const editSongState = (song: Song | null) => ({
  fileHash: song?.file_hash ?? null,
  isAnalyzed: song?.is_analyzed ?? false,
  noStems: song?.no_stems ?? false,
});

type NavigationStateInput = {
  candidateCount: number;
  currentHasLrc: boolean;
  hasLrc: boolean;
  useProvidedTiming: boolean;
  stemsSeparated: boolean;
  saving: boolean;
};

const navigationState = (input: NavigationStateInput) => ({
  hasCandidates: input.candidateCount > 0,
  useSlots: input.currentHasLrc ? 2 : 1,
  timingNav: input.hasLrc && !input.saving,
  audioNav: input.useProvidedTiming && !input.stemsSeparated && !input.saving,
});

const queryError = (error: unknown): Error | null => (error instanceof Error ? error : null);

const editedSong = (mode: ReturnType<typeof useDialog>['mode']): Song | null =>
  isEditLyricsDialogMode(mode) ? mode.song : null;

type FooterMessageInput = {
  hasLrc: boolean;
  useProvidedTiming: boolean;
  lrcLevel: ReturnType<typeof detectLrcLevel>;
  willSeparate: boolean;
  stemsSeparated: boolean;
};

const footerMessage = (input: FooterMessageInput): string | undefined => {
  const hints: string[] = [];
  if (!input.hasLrc) {
    hints.push('Paste LRC / Enhanced LRC to set timing directly.');
  }
  if (input.useProvidedTiming && input.lrcLevel === 'line') {
    hints.push('Line-level LRC highlights whole lines — no per-word timing.');
  }
  if (input.hasLrc && input.useProvidedTiming && !input.willSeparate && !input.stemsSeparated) {
    hints.push('Original mix is used, so pitch scoring will likely be inaccurate.');
  }

  return hints.length > 0 ? hints.join(' ') : undefined;
};

const candidateMeta = (
  candidates: readonly LrclibCandidate[],
  isAnalyzed: boolean,
  loading: boolean,
) => {
  const count = candidates.length;
  const hasMatches = isAnalyzed ? count > 1 : count > 0;
  return { count, showMatchesTab: hasMatches || loading };
};

type TimingMetaInput = {
  hasLrc: boolean;
  timingChoice: TimingChoice;
  isAnalyzed: boolean;
  noStems: boolean;
  separateStems: boolean;
};

const timingMeta = (input: TimingMetaInput) => {
  const useProvidedTiming = input.hasLrc && input.timingChoice === 'provided';
  const stemsSeparated = input.isAnalyzed && !input.noStems;
  return {
    useProvidedTiming,
    stemsSeparated,
    willSeparate: useProvidedTiming && input.separateStems && !stemsSeparated,
  };
};

const canSaveLyrics = (
  saving: boolean,
  loading: boolean,
  changedOrReanalyzing: boolean,
  text: string,
): boolean => !saving && !loading && changedOrReanalyzing && text.trim().length > 0;

const hasSyncedLyrics = (candidate: LrclibCandidate | undefined): boolean =>
  typeof candidate?.synced_lyrics === 'string';

const selectedCandidate = (
  candidates: readonly LrclibCandidate[],
  index: number,
): LrclibCandidate | undefined => candidates.at(Math.min(index, candidates.length - 1));

const getSaveLabel = (
  useProvidedTiming: boolean,
  willSeparate: boolean,
  isAnalyzed: boolean,
): string => {
  if (useProvidedTiming) {
    if (willSeparate) {
      return 'Save & separate stems';
    }
    return isAnalyzed ? 'Use timed lyrics' : 'Save timed lyrics';
  }
  return isAnalyzed ? 'Save & realign' : 'Save & analyze';
};

type NavLayout = {
  stops: number[];
  editorSegment: number | null;
  // Top "header row" containing tabs (slots 0..1) and, on the LRCLIB tab, the
  // carousel arrows (slots 2..3) — all in the same segment so left/right walks
  // across them.
  headerSegment: number | null;
  // Slot offset where the carousel arrows start inside `headerSegment`; null
  // if no arrows in this view.
  arrowSlotStart: number | null;
  // Timing / audio radio rows (each 2 slots) on the edit pane, present only
  // when their controls are enabled.
  timingSegment: number | null;
  audioSegment: number | null;
  useThisSegment: number | null;
  footerSegment: number;
};

type NavLayoutInput = {
  showMatchesTab: boolean;
  activeTab: EditLyricsTab;
  hasCandidates: boolean;
  // Number of action buttons on the current LRCLIB candidate: 2 when it has
  // synced lyrics ("Use LRC" + "Use as plain text"), otherwise 1.
  useSlots: number;
  timingNav: boolean;
  audioNav: boolean;
};

function navLayout({
  showMatchesTab,
  activeTab,
  hasCandidates,
  useSlots,
  timingNav,
  audioNav,
}: NavLayoutInput): NavLayout {
  const onLrclib = showMatchesTab && activeTab === 'lrclib';
  const segments: { key: string; width: number }[] = [];
  let arrowSlotStart: number | null = null;

  if (showMatchesTab) {
    if (onLrclib && hasCandidates) {
      segments.push({ key: 'header', width: 4 });
      arrowSlotStart = 2;
    } else {
      segments.push({ key: 'header', width: 2 });
    }
  }

  if (onLrclib) {
    if (hasCandidates) {
      segments.push({ key: 'use', width: Math.max(1, useSlots) });
    }
  } else {
    segments.push({ key: 'editor', width: 1 });
    if (timingNav) {
      segments.push({ key: 'timing', width: 2 });
    }
    if (audioNav) {
      segments.push({ key: 'audio', width: 2 });
    }
  }

  segments.push({ key: 'footer', width: 2 });

  const indexOf = (key: string): number | null => {
    const i = segments.findIndex((s) => s.key === key);
    return i === -1 ? null : i;
  };

  return {
    stops: segments.map((s) => s.width),
    headerSegment: indexOf('header'),
    arrowSlotStart,
    editorSegment: indexOf('editor'),
    timingSegment: indexOf('timing'),
    audioSegment: indexOf('audio'),
    useThisSegment: indexOf('use'),
    footerSegment: indexOf('footer') ?? segments.length - 1,
  };
}

type EditLyricsWorkspaceProps = {
  showMatches: boolean;
  activeTab: EditLyricsTab;
  setActiveTab: (tab: EditLyricsTab) => void;
  focusTab: (slot: number) => void;
  headerSegment: number | null;
  arrowSlotStart: number | null;
  isFocused: (segment: number, slot?: number) => boolean;
  matchesLoading: boolean;
  candidateCount: number;
  carouselIndex: number;
  setCarouselIndex: (index: number) => void;
  editorPane: ReactNode;
  candidates: LrclibCandidate[];
  matchesError: Error | null;
  useThisSegment: number | null;
  onSelect: (candidate: LrclibCandidate) => void;
  onUseLrc: (candidate: LrclibCandidate) => void;
};

const EditLyricsWorkspace = (props: EditLyricsWorkspaceProps) => {
  if (!props.showMatches) {
    return <div className="flex min-h-0 flex-1 flex-col">{props.editorPane}</div>;
  }

  return (
    <Tabs
      value={props.activeTab}
      onValueChange={(value) => {
        if (value === 'edit' || value === 'lrclib') {
          props.setActiveTab(value);
        }
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex items-center justify-between gap-2">
        <TabsList>
          {EDIT_LYRICS_TABS.map((tab, slot) => (
            <TabsTrigger
              key={tab}
              value={tab}
              onMouseEnter={() => props.focusTab(slot)}
              onPointerDown={() => props.focusTab(slot)}
              onFocus={() => props.focusTab(slot)}
              className={ringFor(
                props.headerSegment !== null && props.isFocused(props.headerSegment, slot),
              )}
            >
              {tab === 'edit' ? 'Edit' : 'LRCLIB matches'}
              {tab === 'lrclib' &&
                (props.matchesLoading ? (
                  <Loader2Icon className="size-3 animate-spin" />
                ) : (
                  `(${props.candidateCount})`
                ))}
            </TabsTrigger>
          ))}
        </TabsList>
        {props.activeTab === 'lrclib' &&
          props.headerSegment !== null &&
          props.arrowSlotStart !== null && (
            <CarouselNav
              index={props.carouselIndex}
              total={props.candidateCount}
              onChange={props.setCarouselIndex}
              isFocused={(slot) =>
                props.isFocused(props.headerSegment ?? 0, (props.arrowSlotStart ?? 0) + slot)
              }
            />
          )}
      </div>
      <TabsContent value="edit" className="mt-3 flex min-h-0 flex-1 flex-col">
        {props.editorPane}
      </TabsContent>
      <TabsContent value="lrclib" className="mt-3 flex min-h-0 flex-1 flex-col">
        <LrclibMatches
          candidates={props.candidates}
          isLoading={props.matchesLoading}
          isError={props.matchesError !== null}
          errorMessage={props.matchesError?.message ?? null}
          index={props.carouselIndex}
          onSelect={props.onSelect}
          onUseLrc={props.onUseLrc}
          isFocused={(slot) =>
            props.useThisSegment !== null && props.isFocused(props.useThisSegment, slot)
          }
        />
      </TabsContent>
    </Tabs>
  );
};

export const EditLyricsDialog = () => {
  const { mode, close } = useDialog();
  const song = editedSong(mode);
  const open = song !== null;
  const { fileHash, isAnalyzed, noStems } = editSongState(song);

  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const editor = useLyricsEditor({ song, onSaved: close });
  const candidatesQuery = useLrclibCandidates(fileHash);
  const candidates = candidatesQuery.data ?? [];
  const matchesLoading = candidatesQuery.isLoading;
  const { count: candidateCount, showMatchesTab } = candidateMeta(
    candidates,
    isAnalyzed,
    matchesLoading,
  );

  const provideLrcMutation = useProvideLrcMutation();
  const applyTimedMutation = useApplyTimedLyricsMutation();
  const saveLyricsMutation = useSaveLyricsMutation();

  const [activeTab, setActiveTab] = useState<EditLyricsTab>('edit');
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [timingChoice, setTimingChoice] = useState<TimingChoice>('provided');
  const [separateStems, setSeparateStems] = useState(false);
  const [lastHash, setLastHash] = useState<string | null>(fileHash);
  if (lastHash !== fileHash) {
    setLastHash(fileHash);
    setActiveTab('edit');
    setCarouselIndex(0);
    setTimingChoice('provided');
    setSeparateStems(false);
  }

  const lrcLevel = useMemo(() => detectLrcLevel(editor.text), [editor.text]);
  const hasLrc = lrcLevel !== 'none';
  const { useProvidedTiming, stemsSeparated, willSeparate } = timingMeta({
    hasLrc,
    timingChoice,
    isAnalyzed,
    noStems,
    separateStems,
  });

  const saving = [
    provideLrcMutation.isLoading,
    applyTimedMutation.isLoading,
    saveLyricsMutation.isLoading,
  ].some(Boolean);
  const canSave = canSaveLyrics(
    saving,
    editor.loadingInitial,
    editor.isDirty || (isAnalyzed && !useProvidedTiming),
    editor.text,
  );

  const saveLabel = getSaveLabel(useProvidedTiming, willSeparate, isAnalyzed);

  const footerHint = footerMessage({
    hasLrc,
    useProvidedTiming,
    lrcLevel,
    willSeparate,
    stemsSeparated,
  });

  const handleSave = () => {
    if (!canSave || !song) {
      return;
    }
    const hash = song.file_hash;
    const title = song.title;

    if (useProvidedTiming) {
      if (willSeparate) {
        provideLrcMutation.mutate(
          { hash, lrcText: editor.text, separateStems: true, title },
          { onSuccess: close },
        );
      } else if (isAnalyzed) {
        applyTimedMutation.mutate({ hash, lrcText: editor.text, title }, { onSuccess: close });
      } else {
        provideLrcMutation.mutate(
          { hash, lrcText: editor.text, separateStems: false, title },
          { onSuccess: close },
        );
      }
      return;
    }

    const lines = hasLrc ? stripLrcToPlainLines(editor.text) : editor.normalized;
    if (lines.length === 0) {
      return;
    }
    saveLyricsMutation.mutate({ hash, lines, title }, { onSuccess: close });
  };

  const applyCandidate = (candidate: LrclibCandidate) => {
    editor.setText(candidate.lines.join('\n'));
    setTimingChoice('provided');
    setActiveTab('edit');
  };

  const applyCandidateLrc = (candidate: LrclibCandidate) => {
    if (candidate.synced_lyrics === null) {
      return;
    }
    editor.setText(candidate.synced_lyrics);
    setTimingChoice('provided');
    setActiveTab('edit');
  };

  const applySidecar = () => {
    editor.applySidecar();
    setTimingChoice('provided');
    setActiveTab('edit');
  };

  const currentCandidate = selectedCandidate(candidates, carouselIndex);
  const nav = navigationState({
    candidateCount,
    currentHasLrc: hasSyncedLyrics(currentCandidate),
    hasLrc,
    useProvidedTiming,
    stemsSeparated,
    saving,
  });

  const layout = navLayout({ showMatchesTab, activeTab, ...nav });

  const { isFocused, focusSegment } = useDialogNav({
    open,
    itemCount: layout.stops.reduce((sum, n) => sum + n, 0),
    stops: layout.stops,
    onBack: close,
    containerRef,
    onAction: (segment, slot, action) => {
      const handleHeader = (): boolean => {
        if (layout.headerSegment === null || segment !== layout.headerSegment) {
          return false;
        }
        if (slot < 2) {
          setActiveTab(slot === 0 ? 'edit' : 'lrclib');
          return true;
        }
        if (layout.arrowSlotStart !== null && slot >= layout.arrowSlotStart) {
          const delta = slot === layout.arrowSlotStart ? -1 : 1;
          setCarouselIndex((index) =>
            Math.min(Math.max(0, index + delta), Math.max(0, candidateCount - 1)),
          );
        }
        return true;
      };

      const handleOption = (): boolean => {
        if (layout.timingSegment !== null && segment === layout.timingSegment) {
          setTimingChoice(slot === 0 ? 'provided' : 'align');
          return true;
        }
        if (layout.audioSegment !== null && segment === layout.audioSegment) {
          setSeparateStems(slot === 1);
          return true;
        }
        return false;
      };

      const handleCandidate = (): boolean => {
        if (layout.useThisSegment === null || segment !== layout.useThisSegment) {
          return false;
        }
        const candidate = selectedCandidate(candidates, carouselIndex);
        if (candidate && hasSyncedLyrics(candidate) && slot === 0) {
          applyCandidateLrc(candidate);
        } else if (candidate) {
          applyCandidate(candidate);
        }
        return true;
      };

      const handleFooter = (): boolean => {
        if (segment !== layout.footerSegment) {
          return false;
        }
        if (slot === 0 && !saving) {
          close();
        } else if (slot !== 0) {
          handleSave();
        }
        return true;
      };

      const textarea = textareaRef.current;
      const editingInTextarea = textarea !== null && document.activeElement === textarea;

      if (editingInTextarea) {
        if (action.back) {
          textarea.blur();
        }
        return true;
      }

      if (!action.confirm) {
        return false;
      }

      if (layout.editorSegment !== null && segment === layout.editorSegment) {
        textarea?.focus();
        return true;
      }

      for (const handler of [handleHeader, handleOption, handleCandidate, handleFooter]) {
        if (handler()) {
          return true;
        }
      }
      return false;
    },
  });

  if (!song) {
    return null;
  }

  const editorFocused = layout.editorSegment !== null && isFocused(layout.editorSegment);
  const focusTab = (slot: number) => {
    if (layout.headerSegment !== null) {
      focusSegment(layout.headerSegment, slot);
    }
  };

  const focusedSlotIn = (segment: number | null): number | null => {
    if (segment === null) {
      return null;
    }
    if (isFocused(segment, 0)) {
      return 0;
    }
    if (isFocused(segment, 1)) {
      return 1;
    }
    return null;
  };

  const carouselHeaderSegment = layout.headerSegment;
  const carouselArrowSlotStart = layout.arrowSlotStart;

  const editorPane = (
    <>
      <LyricsEditor
        textareaRef={textareaRef}
        text={editor.text}
        onChange={editor.setText}
        disabled={editor.loadingInitial || saving}
        loadingInitial={editor.loadingInitial}
        lineCount={editor.normalized.length}
        isDirty={editor.isDirty}
        focused={editorFocused}
      />
      {editor.sidecar ? (
        <SidecarLrcNotice
          fileName={editor.sidecar.file_name}
          kind={editor.sidecar.kind}
          showing={editor.showingSidecar}
          canUse={editor.canUseSidecar && !saving}
          onUse={applySidecar}
        />
      ) : null}
      <LrcOptions
        level={lrcLevel}
        stemsSeparated={stemsSeparated}
        timingChoice={timingChoice}
        onTimingChoiceChange={setTimingChoice}
        separateStems={separateStems}
        onSeparateStemsChange={setSeparateStems}
        disabled={saving}
        timingFocusedSlot={focusedSlotIn(layout.timingSegment)}
        audioFocusedSlot={focusedSlotIn(layout.audioSegment)}
        onFocusOption={(row, slot) => {
          const segment = row === 'timing' ? layout.timingSegment : layout.audioSegment;
          if (segment !== null) {
            focusSegment(segment, slot);
          }
        }}
      />
    </>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          close();
        }
      }}
    >
      <DialogContent className="flex h-[85vh] flex-col sm:max-w-2xl">
        <div ref={containerRef} className="contents">
          <DialogHeader>
            <DialogTitle>Edit lyrics</DialogTitle>
            <DialogDescription>
              Type plain lyrics to run alignment, or paste{' '}
              <a
                href={LRC_SPEC_URL}
                rel="noreferrer"
                onClick={(event) => {
                  event.preventDefault();
                  void openUrl(LRC_SPEC_URL);
                }}
                className="text-primary underline underline-offset-2 hover:text-primary/80"
              >
                LRC / Enhanced LRC
              </a>{' '}
              to set timing directly.
            </DialogDescription>
          </DialogHeader>

          <EditLyricsWorkspace
            showMatches={showMatchesTab}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            focusTab={focusTab}
            headerSegment={carouselHeaderSegment}
            arrowSlotStart={carouselArrowSlotStart}
            isFocused={isFocused}
            matchesLoading={matchesLoading}
            candidateCount={candidateCount}
            carouselIndex={carouselIndex}
            setCarouselIndex={setCarouselIndex}
            editorPane={editorPane}
            candidates={candidates}
            matchesError={queryError(candidatesQuery.error)}
            useThisSegment={layout.useThisSegment}
            onSelect={applyCandidate}
            onUseLrc={applyCandidateLrc}
          />

          <EditLyricsFooter
            onCancel={close}
            onSave={handleSave}
            saving={saving}
            canSave={canSave}
            saveLabel={saveLabel}
            hint={footerHint}
            isFocused={(slot) => isFocused(layout.footerSegment, slot)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};
