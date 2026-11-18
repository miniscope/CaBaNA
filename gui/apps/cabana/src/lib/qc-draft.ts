// The choices made in a QC or Preprocess pop-up before Apply changes. The pop-up edits a draft;
// nothing in the session changes until the draft is committed through the store's own setters.
// Pure, so what applying does and the pending count can be tested.

import type { PrepKey } from './prep-deps.ts';
import { DEFAULT_PREP } from './preprocess.ts';

// ---- Rejected cells (Neural data and Footprints QC)

export interface RejectDraft {
  /** The cells to be rejected once applied. */
  rejected: ReadonlySet<number>;
  /** Show the data with no corrections: nothing rejected. */
  restoreOriginal: boolean;
}

export const startRejectDraft = (applied: ReadonlySet<number>): RejectDraft => ({
  rejected: new Set(applied),
  restoreOriginal: false,
});

/** The cells the draft would leave rejected. */
export const draftRejected = (d: RejectDraft): ReadonlySet<number> =>
  d.restoreOriginal ? new Set<number>() : d.rejected;

/** Reject or keep cells in the draft. Editing while Restore original data is ticked starts from nothing rejected. */
export function setRejects(d: RejectDraft, cells: number[], reject: boolean): RejectDraft {
  const next = new Set(draftRejected(d));
  for (const c of cells) {
    if (reject) next.add(c);
    else next.delete(c);
  }
  return { rejected: next, restoreOriginal: false };
}

export const setRestoreOriginal = (d: RejectDraft, on: boolean): RejectDraft => ({
  ...d,
  restoreOriginal: on,
});

/** What applying the draft does, against the cells rejected now. */
export function rejectChanges(
  applied: ReadonlySet<number>,
  d: RejectDraft,
): { reject: number[]; restore: number[] } {
  const want = draftRejected(d);
  const sorted = (cells: Iterable<number>) => [...cells].sort((a, b) => a - b);
  return {
    reject: sorted([...want].filter((c) => !applied.has(c))),
    restore: sorted([...applied].filter((c) => !want.has(c))),
  };
}

export function pendingRejects(applied: ReadonlySet<number>, d: RejectDraft): number {
  const { reject, restore } = rejectChanges(applied, d);
  return reject.length + restore.length;
}

/** The choice of one overlapping pair as the draft stands: keep both, or reject one of them. */
export function pairChoice(d: RejectDraft, a: number, b: number): 'both' | 'a' | 'b' {
  const r = draftRejected(d);
  return r.has(a) ? 'a' : r.has(b) ? 'b' : 'both';
}

/** Set a pair's choice. Rejecting one cell keeps the other. */
export function setPairChoice(
  d: RejectDraft,
  a: number,
  b: number,
  choice: 'both' | 'a' | 'b',
): RejectDraft {
  const cleared = setRejects(d, [a, b], false);
  return choice === 'both' ? cleared : setRejects(cleared, [choice === 'a' ? a : b], true);
}

// ---- Preprocessing settings

export type PrepValues = typeof DEFAULT_PREP;

export interface PrepDraft {
  /** Values changed in the pop-up; the others stay as applied. */
  values: Partial<PrepValues>;
  /** Show the default settings. */
  resetToDefaults: boolean;
}

export const startPrepDraft = (): PrepDraft => ({ values: {}, resetToDefaults: false });

/** The value a setting would have once applied. */
export function draftValue<K extends PrepKey>(
  applied: PrepValues,
  d: PrepDraft,
  key: K,
): PrepValues[K] {
  if (d.resetToDefaults) return DEFAULT_PREP[key];
  return (d.values[key] ?? applied[key]) as PrepValues[K];
}

/** Change one value in the draft. Editing while Reset to defaults is ticked starts from the defaults. */
export function setPrepValue<K extends PrepKey>(
  d: PrepDraft,
  keys: readonly PrepKey[],
  key: K,
  value: PrepValues[K],
): PrepDraft {
  const values = d.resetToDefaults
    ? Object.fromEntries(keys.map((k) => [k, DEFAULT_PREP[k]]))
    : { ...d.values };
  return { values: { ...values, [key]: value }, resetToDefaults: false };
}

export const setResetToDefaults = (d: PrepDraft, on: boolean): PrepDraft => ({
  ...d,
  resetToDefaults: on,
});

/** The settings (of `keys`) whose draft value differs from the applied one. */
export const modifiedKeys = (applied: PrepValues, d: PrepDraft, keys: readonly PrepKey[]) =>
  keys.filter((k) => draftValue(applied, d, k) !== applied[k]);

/** Hand each modified setting to `set`, as the Preprocess setters take them one at a time. */
export function commitPrep(
  applied: PrepValues,
  d: PrepDraft,
  keys: readonly PrepKey[],
  set: (key: PrepKey, value: number | string) => void,
): void {
  for (const k of modifiedKeys(applied, d, keys)) set(k, draftValue(applied, d, k));
}
