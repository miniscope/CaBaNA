import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../lib/bridge-client.ts';
import {
  browserTestSettings,
  frameworkStatRow,
  categoryCounts,
  parseSavedCsv,
  plotsOf,
  sortRows,
  summarySentences,
  tableStatRows,
  tableText,
  TABLE_SPECS,
} from '../lib/results-explorer.ts';

const AUROC = [
  '# correction: max-stat; alpha=0.05; two-sided',
  'cell,behavior,auroc,p_unadjusted,p_adjusted,response',
  '1,"rear, wall",0.7,0.01,0.04,Excited',
  '1,groom,0.5,0.6,0.9,Not significant',
  '2,groom,0.2,0.002,0.01,Inhibited',
  '2,"rear, wall",,,,Not evaluated',
].join('\n');

const record = (o: Partial<RunRecord> = {}) =>
  ({
    run_id: 'browser-1',
    analysis: 'auroc',
    engine: 'browser-ts',
    scope: 'full',
    status: 'ok',
    created_utc: '2026-10-20T10:00:00Z',
    gui: { settings: {} },
    ...o,
  }) as RunRecord;

describe('parseSavedCsv', () => {
  it('keeps # lines as notes and reads quoted names with commas', () => {
    const t = parseSavedCsv('auroc.csv', AUROC);
    expect(t.notes).toEqual(['correction: max-stat; alpha=0.05; two-sided']);
    expect(t.columns).toEqual([
      'cell',
      'behavior',
      'auroc',
      'p_unadjusted',
      'p_adjusted',
      'response',
    ]);
    expect(t.rows).toHaveLength(4);
    expect(t.rows[0][1]).toBe('rear, wall');
    expect(t.rows[3][2]).toBe(''); // blank stays blank
  });
});

describe('sortRows', () => {
  const t = parseSavedCsv('x', AUROC);
  it('sorts numbers by value and keeps blank cells last in both directions', () => {
    expect(sortRows(t.rows, 2, false).map((r) => r[2])).toEqual(['0.2', '0.5', '0.7', '']);
    expect(sortRows(t.rows, 2, true).map((r) => r[2])).toEqual(['0.7', '0.5', '0.2', '']);
  });
  it('sorts text alphabetically', () => {
    expect(sortRows(t.rows, 1, false).map((r) => r[1])[0]).toBe('groom');
  });
  it('does not change the input', () => {
    const before = t.rows.map((r) => r[2]);
    sortRows(t.rows, 2, true);
    expect(t.rows.map((r) => r[2])).toEqual(before);
  });
});

describe('tableText', () => {
  it('writes header and rows tab separated', () => {
    expect(tableText({ columns: ['a', 'b'], rows: [['1', '2']] })).toBe('a\tb\n1\t2');
  });
});

describe('statistics from a saved table', () => {
  const t = parseSavedCsv('auroc.csv', AUROC);
  const spec = TABLE_SPECS.auroc!;
  it('counts values and p-values below alpha, without computing anything else', () => {
    const [s] = tableStatRows(t, spec, { alpha: 0.05 });
    expect(s).toMatchObject({
      name: 'auROC',
      n: 3,
      range: [0.2, 0.7],
      basis: 'cell-behavior pairs',
    });
    expect(s.pRaw).toEqual({ n: 3, below: 2 });
    expect(s.pAdj).toEqual({ n: 3, below: 2 });
  });
  it('counts each response with the page labels', () => {
    const counts = Object.fromEntries(categoryCounts(t, spec));
    expect(counts['Not evaluated']).toBe(1);
    expect(counts['Not significant']).toBe(1);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(4);
  });
  it('skips a statistic whose column is absent', () => {
    expect(tableStatRows({ ...t, columns: ['cell'] }, spec, { alpha: 0.05 })).toEqual([]);
  });
});

describe('browserTestSettings', () => {
  it('reads the test from the saved settings and metadata', () => {
    expect(
      browserTestSettings(
        'auroc',
        { nShuffles: 500, alpha: 0.01, seed: 3, correction: 'max_stat' },
        { comparison: { method: 'circular_shift' }, statistics: { tail: 'two' } },
      ),
    ).toEqual({
      nullMethod: 'circular shift',
      shuffles: 500,
      alpha: 0.01,
      correction: 'max stat',
      tail: 'two',
      seed: 3,
    });
  });
  it('leaves unrecorded fields undefined', () => {
    const s = browserTestSettings('peth', {}, {});
    expect(s.nullMethod).toBeUndefined();
    expect(s.shuffles).toBeUndefined();
  });
});

describe('summarySentences', () => {
  const t = parseSavedCsv('auroc.csv', AUROC);
  const spec = TABLE_SPECS.auroc!;
  const settings = browserTestSettings('auroc', { nShuffles: 100, alpha: 0.05, seed: 1 }, {});
  const sentences = summarySentences({
    record: record(),
    settings,
    stats: tableStatRows(t, spec, { alpha: 0.05 }),
    categories: { title: 'Response', counts: categoryCounts(t, spec) },
  });
  it('states only saved numbers', () => {
    const all = sentences.join(' ');
    expect(all).toContain('run browser-1');
    expect(all).toContain('3 cell-behavior pairs, from 0.2 to 0.7 (0 to 1 scale)');
    expect(all).toContain('2 of 3 unadjusted p-values are below alpha 0.05');
    expect(all).toContain('2 of 3 adjusted p-values');
    expect(all).toContain('100 shuffles');
    expect(all).toContain('seed 1');
  });
  it('flags a preliminary run and uses no first person or citations', () => {
    const s = summarySentences({ record: record({ scope: 'preview' }), settings: {}, stats: [] });
    expect(s[0]).toContain('Preliminary');
    expect(sentences.join(' ')).not.toMatch(/\b(we|our|my|I)\b|et al/i);
  });
});

describe('plotsOf', () => {
  it('lists the views of each analysis', () => {
    expect(plotsOf('auroc').map((p) => p.view)).toEqual(['inspector', 'heatmap', 'summary']);
    expect(plotsOf('place')).toHaveLength(3);
  });
  it('splits decoding by target', () => {
    expect(plotsOf('decoding', [], 'position').map((p) => p.id)).toEqual([
      'map',
      'trajectory',
      'errors',
    ]);
    expect(plotsOf('decoding', [], 'behaviors').map((p) => p.id)).toEqual([
      'scores',
      'confusion',
      'timeline',
    ]);
    expect(plotsOf('decoding')).toHaveLength(6);
  });
  it('lists only the population methods that finished', () => {
    expect(plotsOf('population', ['pv_similarity', 'pairwise']).map((p) => p.id)).toEqual([
      'similarity',
      'pairwise',
    ]);
    expect(plotsOf('population', [])).toEqual([]);
  });
});

describe('frameworkStatRow', () => {
  const nd = (data: (number | null)[]) => ({ shape: [data.length], data });
  const loaded = {
    meta: { name: 'peth', metric: 'peth_mean', level: 'cell' },
    values: nd([0.5, null, 1.5, 1]),
    extras: {},
    nullDraws: async () => undefined,
    tested: {
      tail: 'two',
      alpha: 0.05,
      nShuffles: 200,
      nullName: 'circular_shift',
      nullParams: {},
      correction: 'max_stat',
      correctionScope: 'behaviors',
      p: nd([0.01, 0.2, null, 0.04]),
      pAdj: nd([0.03, 0.4, null, 0.06]),
      nullLo: null,
      nullHi: null,
      significant: null,
      significantAdj: null,
    },
  } as never;
  it('counts saved values and p-values and carries the saved test', () => {
    const row = frameworkStatRow(loaded);
    expect(row).toMatchObject({
      name: 'peth (peth_mean)',
      n: 3,
      range: [0.5, 1.5],
      basis: 'cell values',
      pRaw: { n: 3, below: 2 },
      pAdj: { n: 3, below: 1 },
    });
    expect(row.test).toEqual({
      nullMethod: 'circular shift',
      shuffles: 200,
      alpha: 0.05,
      correction: 'max stat across behaviors',
      tail: 'two',
    });
  });
});
