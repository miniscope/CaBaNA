// Helpers for the label tables on Load data (mapping and conflict review) and Experimental setup
// (label roles): paging, display names, conflict wording, "Selected in", and the link between the
// two pages. Nothing here changes a stored label name; shortened names are for display only.

import { createSignal } from 'solid-js';
import type { Agreement } from './frame-labels.ts';
import type { LabelEntry, LabelSource } from './labels.ts';
import { goToStep } from './store.ts';

// ---- Paging ----

export const pageCount = (total: number, perPage: number): number =>
  Math.max(1, Math.ceil(total / Math.max(1, perPage)));

/** A page number that exists, so a shrinking list never leaves the view on an empty page. */
export const clampPage = (page: number, total: number, perPage: number): number =>
  Math.min(Math.max(0, page), pageCount(total, perPage) - 1);

export function pageSlice<T>(items: T[], page: number, perPage: number): T[] {
  const start = clampPage(page, items.length, perPage) * perPage;
  return items.slice(start, start + perPage);
}

/** "11-20 of 34" for the pager. */
export function rangeText(page: number, total: number, perPage: number): string {
  if (!total) return '0 of 0';
  const first = clampPage(page, total, perPage) * perPage;
  return `${first + 1}-${Math.min(first + perPage, total)} of ${total}`;
}

// ---- Names ----

/** Middle-truncated text for a narrow cell. The full name goes in the `title`; the name itself is not changed. */
export function shortName(name: string, max = 24): string {
  if (name.length <= max) return name;
  const tail = Math.min(6, Math.floor(max / 3));
  return `${name.slice(0, max - tail - 1)}…${name.slice(name.length - tail)}`;
}

/** A short description of a file column's values for the mapping table, e.g. "0, 1, 98 blank". */
export function columnSample(values: string[], maxShown = 3): string {
  const filled = values.map((v) => v.trim()).filter((v) => v !== '');
  const blank = values.length - filled.length;
  const distinct = [...new Set(filled)];
  const nums = distinct.map(Number);
  const numeric = distinct.length > 0 && nums.every(Number.isFinite);
  let text: string;
  if (!distinct.length) text = 'no values';
  else if (numeric && distinct.length > maxShown)
    text = `${Math.min(...nums)} to ${Math.max(...nums)}`;
  else
    text =
      distinct.slice(0, maxShown).join(', ') +
      (distinct.length > maxShown ? `, +${distinct.length - maxShown} more` : '');
  return blank && distinct.length ? `${text}, ${blank.toLocaleString()} blank` : text;
}

const SOURCE_TEXT: Record<LabelSource, string> = {
  epochs: 'Epochs',
  markers: 'Time markers',
  frame_binary: 'Frame label (binary)',
  frame_categorical: 'Frame label (categorical)',
};
export const sourceText = (s: LabelSource): string => SOURCE_TEXT[s];

const COUNT_UNIT: Record<LabelSource, string> = {
  epochs: 'epochs',
  markers: 'markers',
  frame_binary: 'frames',
  frame_categorical: 'frames',
};
export const countText = (e: Pick<LabelEntry, 'count' | 'source'>): string =>
  `${e.count.toLocaleString()} ${COUNT_UNIT[e.source]}`;

// ---- Conflicts ----

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** One line above the mapping table: "5 conflicts in grooming", or nothing when there are none. */
export function conflictSummary(agreements: Agreement[]): string {
  const bad = agreements.filter((a) => a.conflicts > 0);
  if (!bad.length) return '';
  const total = bad.reduce((n, a) => n + a.conflicts, 0);
  const names = bad.map((a) => shortName(a.label, 20));
  const shown =
    names.length > 3
      ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
      : names.join(', ');
  return `${plural(total, 'conflict', 'conflicts')} in ${shown}.`;
}

/** Frames defined by only one source: reported apart, since they are not conflicts. */
export function oneSourceText(agreements: Agreement[]): string {
  const n = agreements.reduce((sum, a) => sum + a.oneSourceOnly, 0);
  return n
    ? `${plural(n, 'frame is', 'frames are')} defined by one source only (not a conflict).`
    : '';
}

/** What the user can do about a blocked label. Names the label and the way out. */
export function blockedReason(entry: LabelEntry, agreements: Agreement[]): string {
  const g = agreements.find((a) => a.label === entry.name && a.conflicts > 0);
  if (g && entry.source.startsWith('frame_'))
    return `${entry.name}: ${plural(g.conflicts, 'frame disagrees', 'frames disagree')} between the binary column and the categorical column; edit the file or set one column to Ignore.`;
  return `${entry.name}: ${entry.problems.join(' ')}`;
}

export interface ConflictRow {
  label: string;
  frame: number;
  binary: 0 | 1;
  /** The category the frame has instead. */
  categorical: string;
}

/**
 * Every conflicting frame, with both values. The same rule as `agreement` in frame-labels.ts:
 * binary 1 must go with the category equal to the label, and 0 with any other category; a frame
 * with only one source is skipped.
 */
export function conflictRows(
  frames: number[],
  binary: Record<string, (0 | 1 | null)[]>,
  categorical: Record<string, (string | null)[]>,
  labels: string[],
): ConflictRow[] {
  const cats = Object.values(categorical);
  return labels.flatMap((label) => {
    const bin = binary[label];
    const owners = cats.filter((c) => c.includes(label));
    if (!bin || !owners.length) return [];
    return frames.flatMap((frame, i) => {
      const b = bin[i];
      const values = owners.map((c) => c[i]).filter((v): v is string => v !== null);
      if (b === null || !values.length) return [];
      const wrong = values.find((v) => (b === 1) !== (v === label));
      return wrong === undefined ? [] : [{ label, frame, binary: b, categorical: wrong }];
    });
  });
}

/** The time of a camera frame number on the session clock, or undefined when the frame is not in the timestamps. */
export function frameTime(
  frame: number,
  frameNumbers: ArrayLike<number> | undefined,
  times: ArrayLike<number> | undefined,
): number | undefined {
  if (!frameNumbers || !times) return undefined;
  for (let i = 0; i < frameNumbers.length; i++)
    if (frameNumbers[i] === frame) return Number.isFinite(times[i]) ? times[i] : undefined;
  return undefined;
}

// ---- Selected in ----

/** One analysis's label selection. A label is selected when it is available, included and not excluded. */
export interface Selection {
  analysis: string;
  /** Labels the analysis can see; leave out when it takes any. */
  available?: string[];
  /** Chosen labels; empty or missing means all available. */
  include?: string[];
  exclude?: string[];
}

/** The analyses where the label is currently selected, in the order given. */
export function selectedIn(name: string, selections: Selection[]): string[] {
  return selections
    .filter(
      (s) =>
        (!s.available || s.available.includes(name)) &&
        (!s.include?.length || s.include.includes(name)) &&
        !s.exclude?.includes(name),
    )
    .map((s) => s.analysis);
}

export const selectedInText = (analyses: string[]): string =>
  analyses.length ? analyses.join(', ') : 'Not selected';

// ---- Links between Load data and Experimental setup ----

export interface LabelFocus {
  name: string;
  file?: string;
  /** The page that should show it. */
  to: 'load' | 'setup';
}

/** Whether the conflict review is open on Load data (it replaces the file list and preview). */
export const [reviewingConflicts, setReviewingConflicts] = createSignal(false);

/** A pending request to show a label; the target page takes it with `takeFocus`. */
const [focusLabel, setFocusLabel] = createSignal<LabelFocus | undefined>();
/** The label the user came for, kept highlighted after the request is taken. */
const [activeLabel, setActiveLabel] = createSignal<LabelFocus | undefined>();
export { focusLabel, activeLabel };

/** Go to a page with a label (and the file it came from) selected there. */
export function showLabel(to: LabelFocus['to'], name: string, file?: string): void {
  const f = { name, file, to };
  setActiveLabel(f);
  setFocusLabel(f);
  goToStep(to);
}

/** Called by the target page: the request for it, once. */
export function takeFocus(to: LabelFocus['to']): LabelFocus | undefined {
  const f = focusLabel();
  if (f?.to !== to) return undefined;
  setFocusLabel(undefined);
  return f;
}

export const clearActiveLabel = (): void => {
  setActiveLabel(undefined);
  setFocusLabel(undefined);
};
