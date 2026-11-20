// What each row of the Data setup page shows: its status mark (✓, ⚠ or ✕) and which buttons it
// has, and what Data setup still needs before Next. Pure functions of the row's facts, so the page
// and the tests agree.

import { BEHAVIOR_ACTIVITY, type Level, type SlotId } from './slots.ts';

/** The three neural activity files, in processing order: raw, then denoised, then events. */
export const ACTIVITY_SLOTS: SlotId[] = ['neural_raw', 'neural_denoised', 'neural_deconvolved'];

export interface RowFacts {
  level: Level;
  /** A file was read into the slot. */
  loaded: boolean;
  /** The file put in the slot could not be read. */
  error?: string;
  /** A note from reading the file, or a file name the config disagrees with. */
  note?: string;
  /** The file's QC checks, when its QC is shown. */
  qc?: { fails: number; notes: number };
}

export type Tone = 'ok' | 'warn' | 'fail' | 'muted';

export interface RowMark {
  /** ✓ loaded, ⚠ flagged, ✕ failed or unreadable, '' nothing loaded. */
  mark: '✓' | '⚠' | '✕' | '';
  tone: Tone;
  /** The status in words, for the tooltip and screen readers. */
  text: string;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The row's mark: failed checks or an unreadable file first, then notes, then flagged checks. */
export function rowMark(f: RowFacts): RowMark {
  if (f.error) return { mark: '✕', tone: 'fail', text: `Could not be read: ${f.error}` };
  if (!f.loaded) return { mark: '', tone: 'muted', text: 'No file' };
  if (f.qc?.fails)
    return {
      mark: '✕',
      tone: 'fail',
      text: `Loaded · ${count(f.qc.fails, 'check failed', 'checks failed')}`,
    };
  if (f.note) return { mark: '⚠', tone: 'warn', text: `Loaded · ${f.note}` };
  if (f.qc?.notes)
    return {
      mark: '⚠',
      tone: 'warn',
      text: `Loaded · ${count(f.qc.notes, 'check flagged', 'checks flagged')}`,
    };
  return { mark: '✓', tone: 'ok', text: 'Loaded' };
}

/** The Actions of a loaded row: View data only when the file was read. */
export const cardActions = (f: Pick<RowFacts, 'loaded' | 'error'>) => ({
  view: f.loaded && !f.error,
});

/** "a", "a and b", "a, b and c". */
export function joinAnd(xs: string[]): string {
  return xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

const REQUIRED: [SlotId, string][] = [
  ['neural_timestamps', 'neural timestamps'],
  ['neural_deconvolved', 'deconvolved events'],
  ['behavior_timestamps', 'behavioral timestamps'],
];

/**
 * What Data setup still needs, in words: the required files, then one behavioral activity file
 * (an Other data type with a file counts as one).
 */
export function missingRequired(loaded: (id: SlotId) => boolean, otherFiles = 0): string[] {
  const missing = REQUIRED.filter(([id]) => !loaded(id)).map(([, words]) => words);
  if (!otherFiles && !BEHAVIOR_ACTIVITY.some(loaded)) missing.push('one behavioral activity file');
  return missing;
}

/** The line under Next while something required is missing. */
export const blockedText = (missing: string[]): string => `To continue, add ${joinAnd(missing)}`;
