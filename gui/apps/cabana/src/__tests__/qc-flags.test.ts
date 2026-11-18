import { describe, expect, it } from 'vitest';
import type { Check } from '../lib/qc.ts';
import { cellsPhrase, flagLines, noteCounts, pairFlagLines } from '../lib/qc-flags.ts';

const check = (id: string, title: string, status: Check['status'], value?: string): Check => ({
  id,
  group: 'Neural',
  title,
  status,
  detail: '',
  value,
});

describe('flag lines', () => {
  it('counts each note once per cell, most common first', () => {
    expect(
      noteCounts([['low SNR', 'low SNR'], ['correlated with a neighbor'], ['low SNR']]),
    ).toEqual([
      { note: 'low SNR', count: 2 },
      { note: 'correlated with a neighbor', count: 1 },
    ]);
  });

  it('words a count of cells by note', () => {
    expect(cellsPhrase(1, 'low SNR')).toBe('1 cell with low SNR');
    expect(cellsPhrase(13, 'correlated with a neighbor')).toBe(
      '13 cells correlated with a neighbor',
    );
    expect(cellsPhrase(2, 'no events')).toBe('2 cells with no events');
  });

  it('flags cell notes, then checks that did not pass; passed checks go on one line', () => {
    const { flags, passed } = flagLines(
      [['correlated with a neighbor']],
      [
        check('a', 'Signal to noise', 'pass', 'median 16.8'),
        check('b', 'Decay time', 'warn', '0.33 s'),
      ],
    );
    expect(flags.map((f) => [f.n, f.title])).toEqual([
      [1, '1 cell correlated with a neighbor'],
      [2, 'Decay time'],
    ]);
    expect(passed).toBe('Passed: signal to noise (median 16.8)');
  });

  it('has no flags and no passed line when there is nothing', () => {
    expect(flagLines([], [])).toEqual({ flags: [], passed: '' });
  });

  it('lists one flag per overlapping pair, 1-based', () => {
    const { flags } = pairFlagLines(
      [{ a: 4, b: 5, note: '84% shared' }],
      [check('fp-overlap', 'Overlapping footprints', 'fail', '1 pairs')],
    );
    expect(flags).toEqual([{ n: 1, title: 'Cells 5 and 6 overlap', detail: '84% shared' }]);
  });
});
