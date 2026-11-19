import { describe, expect, it } from 'vitest';
import {
  previewRange,
  previewShufflesIssue,
  shufflesFor,
  executedShuffles,
} from '../lib/preview.ts';

describe('shufflesFor', () => {
  it('runs a full analysis at its own count whatever is chosen', () => {
    expect(shufflesFor('full', 1000)).toBe(1000);
    expect(shufflesFor('full', 1000, 100)).toBe(1000);
  });
  it('previews at 50 unless a count is chosen', () => {
    expect(shufflesFor('preview', 1000)).toBe(50);
    expect(shufflesFor('preview', 1000, 100)).toBe(100);
  });
  it('never previews more than the full analysis', () => {
    expect(shufflesFor('preview', 20)).toBe(20);
    expect(shufflesFor('preview', 80, 500)).toBe(80);
  });
});

describe('chosen preview count', () => {
  it('ranges from 10 to the full count', () => {
    expect(previewRange(1000)).toEqual([10, 1000]);
    expect(previewRange(8)).toEqual([8, 8]);
  });
  it('accepts whole numbers in range only', () => {
    expect(previewShufflesIssue(100, 1000)).toBeUndefined();
    expect(previewShufflesIssue(10, 1000)).toBeUndefined();
    expect(previewShufflesIssue(9, 1000)).toBe('Use a whole number from 10 to 1,000.');
    expect(previewShufflesIssue(1001, 1000)).toBeDefined();
    expect(previewShufflesIssue(50.5, 1000)).toBeDefined();
  });
  it('reads the executed count back from a saved preview', () => {
    const saved = { scope: 'preview', gui: { settings: { settingsVersion: 2, analysis: { nShuffles: 100 } } } };
    expect(executedShuffles(saved)).toBe(100);
  });
});
