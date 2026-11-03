import { describe, expect, it } from 'vitest';
import { aurocSettingIssues, DEFAULT_AUROC_SETTINGS } from '../lib/auroc-run.ts';
import { DEFAULT_POPULATION, populationSettingIssues } from '../lib/population-settings.ts';
import { rangeIssue } from '../lib/ranges.ts';

describe('setting ranges', () => {
  it('names the setting and its range when a value is outside it', () => {
    expect(rangeIssue('Alpha', 0.7, { min: 0.001, max: 0.5 })).toBe(
      'Alpha must be a number from 0.001 to 0.5.',
    );
    expect(rangeIssue('Shuffles', 0, { min: 1, whole: true })).toBe(
      'Shuffles must be a whole number from 1.',
    );
    expect(rangeIssue('Shuffles', 2.5, { min: 1, whole: true })).toMatch(/whole number/);
    expect(rangeIssue('Alpha', 0.05, { min: 0.001, max: 0.5 })).toBeUndefined();
  });
  it('auROC blocks an out-of-range value it would use, and ignores one it would not', () => {
    const d = structuredClone(DEFAULT_AUROC_SETTINGS);
    expect(aurocSettingIssues(d)).toEqual([]);
    expect(aurocSettingIssues({ ...d, alpha: 0.9 })).toEqual([
      'Alpha must be a number from 0.001 to 0.5.',
    ]);
    expect(aurocSettingIssues({ ...d, nShuffles: 0 })).toHaveLength(1);
    // the minimum shift is read only when the automatic shift is off
    expect(aurocSettingIssues({ ...d, minShiftS: 0 })).toEqual([]);
    expect(aurocSettingIssues({ ...d, minShiftS: 0, shiftAuto: false })).toHaveLength(1);
  });
  it('Population blocks out-of-range values of the selected methods', () => {
    const d = structuredClone(DEFAULT_POPULATION);
    expect(populationSettingIssues(d)).toEqual([]);
    expect(populationSettingIssues({ ...d, alpha: 2 })).toEqual([
      'Alpha must be a number from 0.0001 to 0.5.',
    ]);
    expect(populationSettingIssues({ ...d, components: 0 })).toHaveLength(1);
    expect(populationSettingIssues({ ...d, components: 0, space: 'all' })).toEqual([]);
  });
});
