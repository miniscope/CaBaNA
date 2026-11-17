// Step states of the Data setup wizard: complete only when that means something.

import { describe, expect, it } from 'vitest';
import { isOptional, stepState, type StepFacts } from '../lib/file-steps.ts';
import { markSkipped, markVisited, skipped, visited } from '../lib/data-setup-view.ts';

const base: StepFacts = {
  section: 'overview',
  visited: false,
  skipped: false,
  qcShown: true,
  scaleSet: false,
};
const st = (f: Partial<StepFacts>) => stepState({ ...base, ...f }).state;

describe('step states', () => {
  it('marks Overview complete once viewed', () => {
    expect(st({})).toBe('todo');
    expect(st({ visited: true })).toBe('done');
  });

  it('marks Arena complete only once the size is set', () => {
    expect(st({ section: 'arena', visited: true })).toBe('todo');
    expect(st({ section: 'arena', scaleSet: true })).toBe('done');
  });

  it('marks QC complete only when opened with no failed check', () => {
    const qc = { fails: 0, notes: 1, total: 4 };
    expect(st({ section: 'qc', qc })).toBe('todo');
    expect(st({ section: 'qc', qc, visited: true })).toBe('done');
    expect(st({ section: 'qc', qc: { ...qc, fails: 2 }, visited: true })).toBe('attention');
    expect(stepState({ ...base, section: 'qc', qc: { ...qc, fails: 2 } }).text).toBe(
      '2 checks failed',
    );
    expect(st({ section: 'qc', visited: true })).toBe('todo');
    expect(st({ section: 'qc', qcShown: false, role: 'reference' })).toBe('off');
  });

  it('never marks Preprocess complete, and not used for reference data', () => {
    expect(st({ section: 'prep', visited: true })).toBe('viewed');
    expect(st({ section: 'prep', skipped: true })).toBe('skipped');
    expect(st({ section: 'prep', role: 'reference' })).toBe('unused');
  });

  it('offers Skip on Preprocess and on reference QC only', () => {
    expect(isOptional({ section: 'prep' })).toBe(true);
    expect(isOptional({ section: 'qc', role: 'reference' })).toBe(true);
    expect(isOptional({ section: 'qc', role: 'analysis' })).toBe(false);
    expect(isOptional({ section: 'overview' })).toBe(false);
  });

  it('keeps skipped until the step is opened on purpose', () => {
    markSkipped('position', 'prep');
    markVisited('position', 'prep');
    expect(skipped('position', 'prep')).toBe(true);
    markVisited('position', 'prep', true);
    expect(skipped('position', 'prep')).toBe(false);
    expect(visited('position', 'prep')).toBe(true);
  });
});
