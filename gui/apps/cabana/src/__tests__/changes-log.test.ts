// The Changes history: rejecting and restoring cells and annotation fixes are logged where they
// run, clearing the session empties the log, and setting values read as words.

import { beforeEach, describe, expect, it } from 'vitest';
import { cellsText, history, lastApplied } from '../lib/changes-log.ts';
import { stepValues, valueText } from '../lib/prep-log.ts';
import { DEFAULT_PREP } from '../lib/preprocess.ts';
import { clearAll, rejectCells, restoreCell } from '../lib/store.ts';

describe('changes history', () => {
  beforeEach(() => clearAll());

  it('logs rejected cells once, and restoring them', () => {
    rejectCells([3, 8]);
    rejectCells([3]); // already rejected: nothing new
    restoreCell(3);
    restoreCell(3); // not rejected any more: nothing logged
    expect(history().map((e) => [e.action, e.text])).toEqual([
      ['apply', 'Rejected cells 4 and 9'],
      ['undo', 'Restored cell 4'],
    ]);
    expect(lastApplied('cell:8')).toBeTypeOf('number');
    expect(lastApplied('cell:11')).toBeUndefined();
  });

  it('is emptied when the session is cleared', () => {
    rejectCells([1]);
    clearAll();
    expect(history()).toEqual([]);
  });

  it('names cells 1-based and shortens long lists', () => {
    expect(cellsText([0])).toBe('Cell 1');
    expect(cellsText([2, 0, 1])).toBe('Cells 1, 2 and 3');
    expect(cellsText([0, 1, 2, 3, 4, 5, 6, 7])).toBe('Cells 1, 2, 3, 4, 5 and 3 more');
  });

  it('puts setting values in words', () => {
    expect(valueText('fillGapS', 0.5)).toBe('0.5 s');
    expect(valueText('eventSigmaS', 0)).toBe('off');
    expect(valueText('minSpeed', 0)).toBe('0 cm/s');
    expect(stepValues('posSmooth', DEFAULT_PREP)).toBe('median, 0.25 s');
  });
});
