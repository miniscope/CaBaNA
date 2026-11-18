// Reasons for rejecting a cell: kept with the rejection, cleared on restore, never changing which
// cells are rejected; rejections without one read "No reason given".

import { beforeEach, describe, expect, it } from 'vitest';
import { NO_REASON, reasonReady, reasonText } from '../lib/reject-reasons.ts';
import { clearAll, reasonOf, rejectCells, rejected, restoreCell } from '../lib/store.ts';

describe('reject reasons', () => {
  beforeEach(() => clearAll());

  it('needs a reason, and a note for Other', () => {
    expect(reasonReady(undefined, '')).toBe(false);
    expect(reasonReady('Flat trace', '')).toBe(true);
    expect(reasonReady('Other', '  ')).toBe(false);
    expect(reasonReady('Other', 'motion')).toBe(true);
  });

  it('writes the reason with its note', () => {
    expect(reasonText('Flat trace')).toBe('Flat trace');
    expect(reasonText('Duplicate of another cell', 'overlaps cell 12')).toBe(
      'Duplicate of another cell: overlaps cell 12',
    );
    expect(reasonText('Other', ' lens edge ')).toBe('lens edge');
  });

  it('keeps the reason with the rejection and drops it on restore', () => {
    rejectCells([2, 5], 'Artifact');
    rejectCells([5, 7], 'Flat trace'); // 5 keeps its first reason
    rejectCells([9]);
    expect([...rejected()].sort((a, b) => a - b)).toEqual([2, 5, 7, 9]);
    expect([2, 5, 7, 9].map(reasonOf)).toEqual(['Artifact', 'Artifact', 'Flat trace', NO_REASON]);
    restoreCell(5);
    expect(reasonOf(5)).toBe(NO_REASON);
    rejectCells([5]);
    expect(reasonOf(5)).toBe(NO_REASON);
  });

  it('is cleared with the session', () => {
    rejectCells([1], 'Artifact');
    clearAll();
    expect(reasonOf(1)).toBe(NO_REASON);
  });
});
