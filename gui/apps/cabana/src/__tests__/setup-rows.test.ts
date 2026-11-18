// Rows of the Data setup page: status words, buttons, and which rows are muted.

import { describe, expect, it } from 'vitest';
import { ACTIVITY_SLOTS, rowActions, rowMuted, rowStatus } from '../lib/setup-rows.ts';

describe('setup rows', () => {
  it('lists the neural activity files in processing order', () => {
    expect(ACTIVITY_SLOTS).toEqual(['neural_raw', 'neural_denoised', 'neural_deconvolved']);
  });

  it('says what is wrong in a few words, worst first', () => {
    expect(rowStatus({ level: 'required', loaded: false })).toEqual({
      text: 'Not loaded',
      tone: 'fail',
    });
    expect(rowStatus({ level: 'optional', loaded: false }).tone).toBe('muted');
    expect(rowStatus({ level: 'optional', loaded: false, error: 'Bad header' })).toEqual({
      text: 'Could not be read',
      tone: 'fail',
      detail: 'Bad header',
    });
    const qc = { fails: 2, notes: 3 };
    expect(rowStatus({ level: 'optional', loaded: true, qc, note: 'x' }).text).toBe(
      'Loaded · 2 checks failed',
    );
    expect(
      rowStatus({
        level: 'optional',
        loaded: true,
        qc: { fails: 0, notes: 1 },
        note: 'Config names a.csv',
      }),
    ).toEqual({
      text: 'Loaded · see note',
      tone: 'warn',
      detail: 'Config names a.csv',
    });
    expect(rowStatus({ level: 'optional', loaded: true, qc: { fails: 0, notes: 1 } }).text).toBe(
      'Loaded · 1 check flagged',
    );
    expect(rowStatus({ level: 'required', loaded: true, qc: { fails: 0, notes: 0 } })).toEqual({
      text: 'Loaded',
      tone: 'ok',
    });
  });

  it('offers View only when there is something to see', () => {
    expect(rowActions({ loaded: true })).toEqual({ view: true, pick: 'Replace' });
    expect(rowActions({ loaded: false })).toEqual({ view: false, pick: 'Load' });
    expect(rowActions({ loaded: false, error: 'x' })).toEqual({ view: true, pick: 'Load' });
  });

  it('mutes empty optional rows only', () => {
    expect(rowMuted({ level: 'optional', loaded: false })).toBe(true);
    expect(rowMuted({ level: 'recommended', loaded: false })).toBe(false);
    expect(rowMuted({ level: 'optional', loaded: true })).toBe(false);
    expect(rowMuted({ level: 'optional', loaded: false, error: 'x' })).toBe(false);
  });
});
