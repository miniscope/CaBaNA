// What each row of the Data setup page shows: the status of its file in words, and which buttons
// it has. Pure functions of the row's facts, so the page and the tests agree.

import type { Level, SlotId } from './slots.ts';

/** The three neural activity files, in processing order: raw, then denoised, then events. */
export const ACTIVITY_SLOTS: SlotId[] = ['neural_raw', 'neural_denoised', 'neural_deconvolved'];
export const isActivity = (slot: SlotId): boolean => ACTIVITY_SLOTS.includes(slot);

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

export interface RowStatus {
  text: string;
  tone: Tone;
  /** The full message, when the text is a short form of it. */
  detail?: string;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The row's status in a few words: failed checks first, then notes, then flagged checks. */
export function rowStatus(f: RowFacts): RowStatus {
  if (f.error) return { text: 'Could not be read', tone: 'fail', detail: f.error };
  if (!f.loaded)
    return f.level === 'required'
      ? { text: 'Not loaded', tone: 'fail' }
      : { text: 'Not loaded', tone: 'muted' };
  if (f.qc?.fails)
    return { text: `Loaded · ${count(f.qc.fails, 'check failed', 'checks failed')}`, tone: 'fail' };
  if (f.note) return { text: 'Loaded · see note', tone: 'warn', detail: f.note };
  if (f.qc?.notes)
    return {
      text: `Loaded · ${count(f.qc.notes, 'check flagged', 'checks flagged')}`,
      tone: 'warn',
    };
  return { text: 'Loaded', tone: 'ok' };
}

/** View once there is something to see (a file, or why it could not be read); Replace or Load. */
export function rowActions(f: Pick<RowFacts, 'loaded' | 'error'>): {
  view: boolean;
  pick: 'Replace' | 'Load';
} {
  return { view: f.loaded || !!f.error, pick: f.loaded ? 'Replace' : 'Load' };
}

/** A row is muted when it has no file and is not needed or only optional. */
export const rowMuted = (f: Pick<RowFacts, 'loaded' | 'error' | 'level'>): boolean =>
  !f.loaded && !f.error && (f.level === 'optional' || f.level === 'unused');

export const LEVEL_WORD: Record<Level, string> = {
  required: 'Required',
  recommended: 'Recommended',
  optional: 'Optional',
  unused: 'Not needed',
};

/** The status on a card row, in the page's words: no "Loaded ·" prefix; a flag says how many. */
export function cardStatus(f: RowFacts): RowStatus {
  if (f.error) return { text: 'Could not be read', tone: 'fail', detail: f.error };
  if (!f.loaded) return { text: 'Not loaded', tone: 'muted' };
  if (f.qc?.fails)
    return { text: count(f.qc.fails, 'check failed', 'checks failed'), tone: 'fail' };
  if (f.note) return { text: 'See note', tone: 'warn', detail: f.note };
  if (f.qc?.notes)
    return { text: count(f.qc.notes, 'check flagged', 'checks flagged'), tone: 'warn' };
  return { text: 'Loaded', tone: 'ok' };
}

/** The row's second line: data type, level, and what the file holds. Empty slots say what to load. */
export function rowDescription(label: string, level: Level, facts?: string, hint?: string): string {
  return [label, LEVEL_WORD[level].toLowerCase(), facts || hint].filter(Boolean).join(' · ');
}

/** The Actions of a loaded row: View data only when the file was read. */
export const cardActions = (f: Pick<RowFacts, 'loaded' | 'error'>) => ({
  view: f.loaded && !f.error,
});
