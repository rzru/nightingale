/**
 * Document model of the lyrics timing editor: lines of timed words and the
 * edits on them. Every edit returns a new document, so undo and redo are a
 * list of snapshots. Pure module, shared by the app and the Node tests.
 */

export type EditorWord = {
  /** Stable within the document: keeps a word's block while it is dragged. */
  id: number;
  text: string;
  start: number;
  end: number;
  /** Shown but not scored: sighs, ad-libs, spoken inserts. */
  noSing?: boolean;
  /** Syllable of a longer word (UltraStar style): no space after it. */
  joined?: boolean;
};

export type EditorLine = {
  id: number;
  words: EditorWord[];
};

export type EditorDoc = {
  lines: EditorLine[];
  /** Id for the next word or line an edit creates. */
  nextId: number;
};

export type WordRef = { line: number; word: number };

/** Shortest word the editor lets you make. */
export const MIN_WORD_SEC = 0.05;

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

const clampTime = (value: number): number => round3(Math.max(0, value));

function mapWord(
  doc: EditorDoc,
  ref: WordRef,
  change: (word: EditorWord) => EditorWord,
): EditorDoc {
  return {
    lines: doc.lines.map((line, li) =>
      li === ref.line
        ? {
            id: line.id,
            words: line.words.map((word, wi) => (wi === ref.word ? change(word) : word)),
          }
        : line,
    ),
    nextId: doc.nextId,
  };
}

const mapLine = (
  doc: EditorDoc,
  lineIndex: number,
  change: (line: EditorLine) => EditorLine[],
): EditorDoc => ({
  lines: doc.lines.flatMap((line, li) => (li === lineIndex ? change(line) : [line])),
  nextId: doc.nextId,
});

export const wordAt = (doc: EditorDoc, ref: WordRef): EditorWord | undefined =>
  doc.lines.at(ref.line)?.words.at(ref.word);

export function lineBounds(line: EditorLine): { start: number; end: number } {
  const first = line.words.at(0);
  const last = line.words.at(-1);
  return { start: first?.start ?? 0, end: last?.end ?? 0 };
}

export const setWordText = (doc: EditorDoc, ref: WordRef, text: string): EditorDoc =>
  mapWord(doc, ref, (word) => ({ ...word, text }));

/** Set a word's start and end; the word keeps at least `MIN_WORD_SEC`. */
export function setWordTimes(doc: EditorDoc, ref: WordRef, start: number, end: number): EditorDoc {
  const from = clampTime(start);
  const to = Math.max(clampTime(end), round3(from + MIN_WORD_SEC));
  return mapWord(doc, ref, (word) => ({ ...word, start: from, end: to }));
}

export const toggleNoSing = (doc: EditorDoc, ref: WordRef): EditorDoc =>
  mapWord(doc, ref, ({ noSing, ...word }) => (noSing === true ? word : { ...word, noSing: true }));

const shiftWord = (word: EditorWord, delta: number): EditorWord => {
  // Keep the duration when the shift is stopped at zero.
  const start = clampTime(word.start + delta);
  return { ...word, start, end: round3(start + (word.end - word.start)) };
};

export const shiftWordBy = (doc: EditorDoc, ref: WordRef, delta: number): EditorDoc =>
  mapWord(doc, ref, (word) => shiftWord(word, delta));

export const shiftLineBy = (doc: EditorDoc, lineIndex: number, delta: number): EditorDoc =>
  mapLine(doc, lineIndex, (line) => [
    { id: line.id, words: line.words.map((word) => shiftWord(word, delta)) },
  ]);

export const shiftAllBy = (doc: EditorDoc, delta: number): EditorDoc => ({
  lines: doc.lines.map((line) => ({
    id: line.id,
    words: line.words.map((word) => shiftWord(word, delta)),
  })),
  nextId: doc.nextId,
});

/** Split a word's text at `at` characters; time is divided by text length. */
export function splitWord(doc: EditorDoc, ref: WordRef, at: number): EditorDoc {
  const word = wordAt(doc, ref);
  if (word === undefined || at <= 0 || at >= word.text.length) {
    return doc;
  }
  const middle = round3(word.start + ((word.end - word.start) * at) / word.text.length);
  const { joined, ...rest } = word;
  const left: EditorWord = { ...rest, text: word.text.slice(0, at).trimEnd(), end: middle };
  const right: EditorWord = {
    ...rest,
    id: doc.nextId,
    text: word.text.slice(at).trimStart(),
    start: middle,
  };
  if (joined === true) {
    right.joined = true;
  }
  const split = mapLine(doc, ref.line, (line) => [
    { id: line.id, words: line.words.flatMap((w, wi) => (wi === ref.word ? [left, right] : [w])) },
  ]);
  return { lines: split.lines, nextId: doc.nextId + 1 };
}

/** Merge a word with the next one in its line. */
export function mergeWithNext(doc: EditorDoc, ref: WordRef): EditorDoc {
  const word = wordAt(doc, ref);
  const next = wordAt(doc, { line: ref.line, word: ref.word + 1 });
  if (word === undefined || next === undefined) {
    return doc;
  }
  const { joined, ...rest } = word;
  const merged: EditorWord = {
    ...rest,
    text: joined === true ? `${word.text}${next.text}` : `${word.text} ${next.text}`,
    end: next.end,
  };
  if (next.joined === true) {
    merged.joined = true;
  }
  return mapLine(doc, ref.line, (line) => [
    {
      id: line.id,
      words: line.words.flatMap((w, wi) => {
        if (wi === ref.word) {
          return [merged];
        }
        return wi === ref.word + 1 ? [] : [w];
      }),
    },
  ]);
}

/** Start a new line at the given word. */
export function splitLine(doc: EditorDoc, ref: WordRef): EditorDoc {
  if (ref.word <= 0) {
    return doc;
  }
  const line = doc.lines.at(ref.line);
  if (line === undefined || ref.word >= line.words.length) {
    return doc;
  }
  const split = mapLine(doc, ref.line, (current) => [
    { id: current.id, words: current.words.slice(0, ref.word) },
    { id: doc.nextId, words: current.words.slice(ref.word) },
  ]);
  return { lines: split.lines, nextId: doc.nextId + 1 };
}

/** Join a line with the next one. */
export function mergeLineWithNext(doc: EditorDoc, lineIndex: number): EditorDoc {
  const next = doc.lines.at(lineIndex + 1);
  if (next === undefined || lineIndex < 0) {
    return doc;
  }
  return {
    lines: doc.lines.flatMap((line, li) => {
      if (li === lineIndex) {
        return [{ id: line.id, words: [...line.words, ...next.words] }];
      }
      return li === lineIndex + 1 ? [] : [line];
    }),
    nextId: doc.nextId,
  };
}

/** Insert a new word after `ref`, in the gap before the next word. */
export function addWordAfter(doc: EditorDoc, ref: WordRef, text: string): EditorDoc {
  const word = wordAt(doc, ref);
  if (word === undefined) {
    return doc;
  }
  const next = wordAt(doc, { line: ref.line, word: ref.word + 1 });
  const start = word.end;
  const room = next === undefined ? 0.4 : next.start - start;
  const added: EditorWord = {
    id: doc.nextId,
    text,
    start,
    end: round3(start + Math.max(MIN_WORD_SEC, Math.min(0.4, room))),
  };
  const withWord = mapLine(doc, ref.line, (line) => [
    { id: line.id, words: line.words.flatMap((w, wi) => (wi === ref.word ? [w, added] : [w])) },
  ]);
  return { lines: withWord.lines, nextId: doc.nextId + 1 };
}

/** Delete a word; a line left without words is removed. */
export function deleteWord(doc: EditorDoc, ref: WordRef): EditorDoc {
  return mapLine(doc, ref.line, (line) => {
    const words = line.words.filter((_, wi) => wi !== ref.word);
    return words.length === 0 ? [] : [{ id: line.id, words }];
  });
}

/**
 * Tap timing: the song plays and the user taps once per word. A tap starts the
 * word at `time` and ends the previous word of the line there.
 */
export function tapWord(doc: EditorDoc, ref: WordRef, time: number): EditorDoc {
  const word = wordAt(doc, ref);
  if (word === undefined) {
    return doc;
  }
  const start = clampTime(time);
  let next = mapWord(doc, ref, (w) => ({
    ...w,
    start,
    end: Math.max(round3(start + MIN_WORD_SEC), w.end > start ? w.end : round3(start + 0.3)),
  }));
  const previous = wordAt(next, { line: ref.line, word: ref.word - 1 });
  if (previous !== undefined && ref.word > 0) {
    next = mapWord(next, { line: ref.line, word: ref.word - 1 }, (w) => ({
      ...w,
      start: Math.min(w.start, round3(start - MIN_WORD_SEC)),
      end: start,
    }));
  }
  return next;
}

/** End the tapped word when the key is released after the last word of a line. */
export const tapEnd = (doc: EditorDoc, ref: WordRef, time: number): EditorDoc =>
  mapWord(doc, ref, (w) => ({
    ...w,
    end: Math.max(round3(w.start + MIN_WORD_SEC), clampTime(time)),
  }));

/** The word after `ref` in reading order, crossing into the next line. */
export function nextWordRef(doc: EditorDoc, ref: WordRef): WordRef | null {
  const line = doc.lines.at(ref.line);
  if (line === undefined) {
    return null;
  }
  if (ref.word + 1 < line.words.length) {
    return { line: ref.line, word: ref.word + 1 };
  }
  return ref.line + 1 < doc.lines.length ? { line: ref.line + 1, word: 0 } : null;
}

// ── Undo / redo ───────────────────────────────────────────────────────────

export type History = {
  past: EditorDoc[];
  present: EditorDoc;
  future: EditorDoc[];
};

const HISTORY_LIMIT = 200;

export const newHistory = (doc: EditorDoc): History => ({ past: [], present: doc, future: [] });

/** Record an edit. An edit that changes nothing leaves the history alone. */
export function commit(history: History, doc: EditorDoc): History {
  if (doc === history.present) {
    return history;
  }
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: doc,
    future: [],
  };
}

export function undo(history: History): History {
  const previous = history.past.at(-1);
  if (previous === undefined) {
    return history;
  }
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo(history: History): History {
  const next = history.future.at(0);
  if (next === undefined) {
    return history;
  }
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}

// ── Transcript conversion ─────────────────────────────────────────────────

type TranscriptWordLike = {
  word: string;
  start: number;
  end: number;
  no_sing?: boolean;
  joined?: boolean;
};

type TranscriptSegmentLike = { words: TranscriptWordLike[] };

export type SavedWord = {
  word: string;
  start: number;
  end: number;
  no_sing?: boolean;
  joined?: boolean;
};

export type SavedSegment = { text: string; start: number; end: number; words: SavedWord[] };

export function docFromSegments(segments: readonly TranscriptSegmentLike[]): EditorDoc {
  let nextId = 0;
  const takeId = (): number => {
    nextId += 1;
    return nextId - 1;
  };
  const lines = segments
    .filter((segment) => segment.words.length > 0)
    .map((segment) => ({
      id: takeId(),
      words: segment.words.map((word) => ({
        id: takeId(),
        text: word.word,
        start: word.start,
        end: word.end,
        ...(word.no_sing === true ? { noSing: true } : {}),
        ...(word.joined === true ? { joined: true } : {}),
      })),
    }));
  return { lines, nextId };
}

const lineText = (line: EditorLine): string =>
  line.words
    .map((word) => (word.joined === true ? word.text : `${word.text} `))
    .join('')
    .trim();

/** Segments to save: empty words dropped, words and lines in time order. */
export function segmentsFromDoc(doc: EditorDoc): SavedSegment[] {
  return doc.lines
    .map((line) => ({
      id: line.id,
      words: line.words
        .filter((word) => word.text.trim() !== '')
        .toSorted((a, b) => a.start - b.start),
    }))
    .filter((line) => line.words.length > 0)
    .toSorted((a, b) => lineBounds(a).start - lineBounds(b).start)
    .map((line) => ({
      text: lineText(line),
      start: lineBounds(line).start,
      end: lineBounds(line).end,
      words: line.words.map((word) => ({
        word: word.text.trim(),
        start: word.start,
        end: word.end,
        ...(word.noSing === true ? { no_sing: true } : {}),
        ...(word.joined === true ? { joined: true } : {}),
      })),
    }));
}

/** Problems that would make the saved lyrics misbehave on screen. */
export function validateDoc(doc: EditorDoc): { ref: WordRef; problem: 'overlap' | 'empty' }[] {
  const problems: { ref: WordRef; problem: 'overlap' | 'empty' }[] = [];
  doc.lines.forEach((line, li) => {
    line.words.forEach((word, wi) => {
      if (word.text.trim() === '') {
        problems.push({ ref: { line: li, word: wi }, problem: 'empty' });
      }
      const next = line.words.at(wi + 1);
      if (next !== undefined && next.start < word.end - 0.001) {
        problems.push({ ref: { line: li, word: wi }, problem: 'overlap' });
      }
    });
  });
  return problems;
}
