import { describe, expect, it } from 'vitest';
import { DEFAULT_PREP } from '../lib/preprocess.ts';
import {
  commitPrep,
  draftValue,
  modifiedKeys,
  pairChoice,
  pendingRejects,
  rejectChanges,
  setPairChoice,
  setPrepValue,
  setRejects,
  setResetToDefaults,
  setRestoreOriginal,
  startPrepDraft,
  startRejectDraft,
} from '../lib/qc-draft.ts';

describe('rejected-cell draft', () => {
  const applied = new Set([12]);

  it('starts with nothing pending', () => {
    const d = startRejectDraft(applied);
    expect(pendingRejects(applied, d)).toBe(0);
    expect(rejectChanges(applied, d)).toEqual({ reject: [], restore: [] });
  });

  it('lists cells to reject and restore, sorted, and counts both', () => {
    let d = startRejectDraft(applied);
    d = setRejects(d, [9, 3], true);
    d = setRejects(d, [12], false);
    expect(rejectChanges(applied, d)).toEqual({ reject: [3, 9], restore: [12] });
    expect(pendingRejects(applied, d)).toBe(3);
  });

  it('rejecting a cell already rejected changes nothing', () => {
    expect(pendingRejects(applied, setRejects(startRejectDraft(applied), [12], true))).toBe(0);
  });

  it('Restore original data leaves nothing rejected, and unticking brings the choices back', () => {
    let d = setRejects(startRejectDraft(applied), [3], true);
    d = setRestoreOriginal(d, true);
    expect(rejectChanges(applied, d)).toEqual({ reject: [], restore: [12] });
    d = setRestoreOriginal(d, false);
    expect(rejectChanges(applied, d)).toEqual({ reject: [3], restore: [] });
  });

  it('editing while Restore original data is ticked starts from nothing rejected', () => {
    const d = setRejects(setRestoreOriginal(startRejectDraft(applied), true), [5], true);
    expect(d.restoreOriginal).toBe(false);
    expect(rejectChanges(applied, d)).toEqual({ reject: [5], restore: [12] });
  });

  it('a pair choice rejects one cell and keeps the other', () => {
    const none = new Set<number>();
    let d = startRejectDraft(none);
    expect(pairChoice(d, 4, 7)).toBe('both');
    d = setPairChoice(d, 4, 7, 'a');
    expect(pairChoice(d, 4, 7)).toBe('a');
    d = setPairChoice(d, 4, 7, 'b');
    expect(rejectChanges(none, d).reject).toEqual([7]);
    d = setPairChoice(d, 4, 7, 'both');
    expect(pendingRejects(none, d)).toBe(0);
  });
});

describe('preprocessing draft', () => {
  const keys = ['eventSigmaS', 'traceSigmaS'] as const;
  const applied = { ...DEFAULT_PREP, eventSigmaS: 0.2 };

  it('shows applied values until one is changed', () => {
    const d = startPrepDraft();
    expect(draftValue(applied, d, 'eventSigmaS')).toBe(0.2);
    expect(modifiedKeys(applied, d, keys)).toEqual([]);
  });

  it('counts only values that differ from what is applied, and a value set to 0 is a change', () => {
    let d = setPrepValue(startPrepDraft(), keys, 'traceSigmaS', 0.3);
    d = setPrepValue(d, keys, 'eventSigmaS', 0.2);
    expect(modifiedKeys(applied, d, keys)).toEqual(['traceSigmaS']);
    d = setPrepValue(d, keys, 'eventSigmaS', 0);
    expect(modifiedKeys(applied, d, keys)).toEqual(['eventSigmaS', 'traceSigmaS']);
  });

  it('Reset to defaults previews the defaults and changes what differs from them', () => {
    const d = setResetToDefaults(startPrepDraft(), true);
    expect(draftValue(applied, d, 'eventSigmaS')).toBe(DEFAULT_PREP.eventSigmaS);
    expect(modifiedKeys(applied, d, keys)).toEqual(['eventSigmaS']);
  });

  it('editing while Reset to defaults is ticked keeps the other settings at their defaults', () => {
    const d = setPrepValue(setResetToDefaults(startPrepDraft(), true), keys, 'traceSigmaS', 0.5);
    expect(d.resetToDefaults).toBe(false);
    expect(draftValue(applied, d, 'eventSigmaS')).toBe(DEFAULT_PREP.eventSigmaS);
    expect(draftValue(applied, d, 'traceSigmaS')).toBe(0.5);
  });

  it('commits only the modified settings, through the setter', () => {
    const calls: [string, number | string][] = [];
    const d = setPrepValue(startPrepDraft(), keys, 'traceSigmaS', 0.3);
    commitPrep(applied, d, keys, (k, v) => calls.push([k, v]));
    expect(calls).toEqual([['traceSigmaS', 0.3]]);
  });
});
