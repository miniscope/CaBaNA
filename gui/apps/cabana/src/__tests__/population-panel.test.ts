import { describe, expect, it } from 'vitest';
import type { LabelEntry } from '../lib/labels.ts';
import type { PairRow } from '../lib/population-results.ts';
import { DEFAULT_POPULATION, type PopulationSettings } from '../lib/population-settings.ts';
import {
  binsOf,
  colorCss,
  colorLimits,
  colorRgb,
  correctionScope,
  framesPerBlock,
  histogram,
  labelMinimum,
  labelReason,
  labelRow,
  matrixCsv,
  methodReadiness,
  niceTicks,
  offDiagonalRowMeans,
  pageCount,
  pageOf,
  pairsCsv,
  perStateCsv,
  resultScope,
  scaleKind,
  similarityLimits,
  stateOrder,
  truncate,
  type LabelRow,
  type ReadinessContext,
} from '../panels/population/logic.ts';

const settings = (o: Partial<PopulationSettings> = {}): PopulationSettings => ({
  ...structuredClone(DEFAULT_POPULATION),
  ...o,
  methods: { ...DEFAULT_POPULATION.methods, ...o.methods },
});
const row = (name: string, bins: number, blockBins = [bins / 2, bins / 2]): LabelRow => ({
  name,
  bins,
  blockBins,
  problems: [],
  blocked: false,
});
const ctx = (rows: LabelRow[], o: Partial<ReadinessContext> = {}): ReadinessContext => ({
  rows,
  selected: rows.map((r) => r.name),
  nCells: 148,
  totalBins: 400,
  hasArena: true,
  hasPosition: true,
  ...o,
});

describe('time bins per label', () => {
  it('fills whole bins of the chosen size', () => {
    expect(binsOf(200, 20, 0.5)).toBe(20); // 10 s at 20 Hz in 0.5 s bins
    expect(binsOf(209, 20, 0.5)).toBe(20);
    expect(binsOf(0, 20, 0.5)).toBe(0);
    expect(binsOf(100, 0, 0.5)).toBe(0);
  });

  it('counts the frames of a mask in each block of the session', () => {
    const mask = [1, 1, 0, 0, 1, 0, 0, 1];
    expect(framesPerBlock(mask, 2)).toEqual([2, 2]);
    expect(framesPerBlock(mask, 1)).toEqual([4]);
    expect(framesPerBlock(mask, 4)).toEqual([2, 0, 1, 1]);
  });

  it('builds a row with its registry problems', () => {
    const entry = (e: Partial<LabelEntry>): LabelEntry => ({
      name: 'x',
      source: 'epochs',
      file: 'a.csv',
      slot: 'behavior_annotations',
      count: 1,
      problems: [],
      blocked: false,
      ...e,
    });
    const r = labelRow(
      'sniff',
      [
        entry({ name: 'sniff', problems: ['Duplicate label: also in b.csv'], blocked: true }),
        entry({ name: 'other' }),
      ],
      [40, 20],
      20,
      0.5,
    );
    expect(r.bins).toBe(6);
    expect(r.blockBins).toEqual([4, 2]);
    expect(r.blocked).toBe(true);
    expect(r.problems).toEqual(['Duplicate label: also in b.csv']);
  });
});

describe('label reasons', () => {
  it('names the real shortfall: bins found of bins needed', () => {
    expect(labelReason(row('freeze', 6), settings())).toBe(
      'insufficient usable bins: 6 of 20 needed',
    );
    expect(labelReason(row('follow', 20), settings())).toBeUndefined();
  });

  it('the strictest selected method sets the minimum', () => {
    expect(labelMinimum(settings()).min).toBe(20);
    expect(
      labelMinimum(settings({ methods: { ...DEFAULT_POPULATION.methods, separation: false } })).min,
    ).toBe(2);
    const perState = settings({ perStateParticipation: true });
    expect(labelMinimum(perState)).toEqual({ min: 50, by: 'per-state participation ratio' });
  });

  it('a blocked label shows its registry reason, not a bin count', () => {
    const r = { ...row('sniff', 100), blocked: true, problems: ['Duplicate label: also in b.csv'] };
    expect(labelReason(r, settings())).toBe('Duplicate label: also in b.csv');
  });

  it('truncates long names with an ellipsis', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('a very long behavior name', 10)).toBe('a very lo…');
    expect(truncate('a very long behavior name', 10)).toHaveLength(10);
  });
});

describe('readiness per method', () => {
  const rows = [row('follow', 100), row('sniff', 60), row('rest', 30)];

  it('is ready on enough labels and bins', () => {
    for (const m of [
      'similarity',
      'stability',
      'separation',
      'dimensionality',
      'pairwise',
    ] as const)
      expect(methodReadiness(m, settings(), ctx(rows)).ready).toBe(true);
  });

  it('needs at least 2 selected labels', () => {
    const r = methodReadiness('similarity', settings(), ctx(rows, { selected: ['follow'] }));
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(/at least 2 usable labels \(selected 1\)/);
  });

  it('stability needs 2 blocks and bins of a label in every block', () => {
    expect(methodReadiness('stability', settings({ stabilityBlocks: 1 }), ctx(rows)).reason).toBe(
      'Needs at least 2 blocks.',
    );
    const lopsided = [row('a', 100, [100, 0]), row('b', 60, [0, 60])];
    const r = methodReadiness('stability', settings(), ctx(lopsided));
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(/No label has 1 or more bins in each of the 2 blocks/);
  });

  it('PCA separation needs 2 labels with 20 or more bins', () => {
    const r = methodReadiness('separation', settings(), ctx([row('a', 100), row('b', 6)]));
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(
      /at least 2 labels with 20 or more bins \(1 of 2 labels have enough\)/,
    );
    expect(
      methodReadiness('separation', settings({ space: 'all' }), ctx([row('a', 100), row('b', 6)]))
        .ready,
    ).toBe(true);
  });

  it('components cannot exceed the kept cells', () => {
    const r = methodReadiness(
      'separation',
      settings({ components: 200 }),
      ctx(rows, { nCells: 148 }),
    );
    expect(r.reason).toBe('Asks for 200 components but only 148 cells are kept.');
  });

  it('noise correlation needs exclusive states', () => {
    const s = settings({ pairwiseKind: 'noise' });
    expect(methodReadiness('pairwise', s, ctx(rows)).reason).toMatch(
      /exclusive states; behaviors can overlap/,
    );
    expect(methodReadiness('pairwise', { ...s, target: 'zones' }, ctx(rows)).ready).toBe(true);
  });

  it('dimensionality and pairwise need 50 time bins', () => {
    expect(methodReadiness('dimensionality', settings(), ctx(rows, { totalBins: 30 })).reason).toBe(
      'Needs 50 or more time bins (found 30).',
    );
    expect(methodReadiness('pairwise', settings(), ctx(rows, { totalBins: 30 })).ready).toBe(false);
  });

  it('position target needs the arena outline and a position file', () => {
    const s = settings({ target: 'position' });
    expect(methodReadiness('similarity', s, ctx([], { hasArena: false })).reason).toMatch(
      /arena outline/,
    );
    expect(methodReadiness('similarity', s, ctx([], { hasPosition: false })).reason).toMatch(
      /position file/,
    );
    expect(methodReadiness('similarity', s, ctx([])).ready).toBe(true);
  });
});

describe('correction scope', () => {
  it('matrix results stay uncorrected and say how many pairs were tested', () => {
    const lines = correctionScope(settings({ correction: 'max_stat' }), 4);
    const text = (m: string) => lines.find((l) => l.method === m)!;
    expect(text('similarity').text).toBe('Uncorrected; 6 state pairs tested');
    expect(text('separation').text).toBe('Uncorrected; 6 state pairs tested');
    expect(text('similarity').corrected).toBe(false);
    expect(text('stability').text).toBe('Max-stat correction across 4 states');
    expect(text('stability').corrected).toBe(true);
  });

  it('without a correction every result is uncorrected', () => {
    const lines = correctionScope(settings(), 3);
    expect(lines.every((l) => !l.corrected)).toBe(true);
    expect(lines.find((l) => l.method === 'stability')!.text).toBe('Uncorrected; 3 states tested');
  });

  it('participation ratio is corrected only per state', () => {
    const on = settings({ correction: 'max_stat' });
    expect(correctionScope(on, 3).find((l) => l.method === 'dimensionality')!.text).toMatch(
      /One test for the session/,
    );
    const per = correctionScope({ ...on, perStateParticipation: true }, 3).find(
      (l) => l.method === 'dimensionality',
    )!;
    expect(per.corrected).toBe(true);
  });

  it('lists only the selected methods, pairwise as descriptive', () => {
    const lines = correctionScope(
      settings({ methods: { ...DEFAULT_POPULATION.methods, pairwise: true } }),
      3,
    );
    expect(lines.map((l) => l.method)).toEqual([
      'similarity',
      'stability',
      'separation',
      'dimensionality',
      'pairwise',
    ]);
    expect(lines.at(-1)!.text).toBe('Descriptive; no significance test');
  });

  it('position bins give no pair count before the run', () => {
    expect(correctionScope(settings({ target: 'position' }), undefined)[0].text).toBe(
      'Uncorrected; one test per state pair',
    );
  });

  it('a saved result states its own correction', () => {
    expect(resultScope('similarity', { correction: 'none' }, { nStates: 3 })).toBe(
      'Uncorrected; 3 state pairs tested',
    );
    expect(resultScope('stability', { correction: 'max_stat' }, { nStates: 5 })).toBe(
      'Max-stat correction across 5 states',
    );
    expect(resultScope('stability', { correction: 'none' }, { nStates: 5 })).toBe(
      'Uncorrected; 5 states tested',
    );
    expect(resultScope('pairwise', undefined, { nStates: 0 })).toBe(
      'Descriptive; no significance test',
    );
  });
});

describe('color scale', () => {
  it('cosine is sequential 0 to 1, Pearson diverging -1 to 1', () => {
    expect(scaleKind('cosine')).toBe('sequential');
    expect(scaleKind('pearson')).toBe('diverging');
    expect(similarityLimits('cosine')).toEqual({ lo: 0, hi: 1 });
    expect(similarityLimits('pearson')).toEqual({ lo: -1, hi: 1 });
    expect(similarityLimits('euclidean')).toBeUndefined();
  });

  it('maps the ends of the sequential scale to light and dark', () => {
    const lo = colorRgb(0, 'sequential', 0, 1);
    const hi = colorRgb(1, 'sequential', 0, 1);
    expect(lo[0]).toBeGreaterThan(hi[0]);
    expect(colorRgb(-5, 'sequential', 0, 1)).toEqual(lo); // clamped
    expect(colorRgb(9, 'sequential', 0, 1)).toEqual(hi);
  });

  it('the diverging scale is white at zero, red above and blue below', () => {
    expect(colorRgb(0, 'diverging', -1, 1)).toEqual([255, 255, 255]);
    const pos = colorRgb(1, 'diverging', -1, 1);
    const neg = colorRgb(-1, 'diverging', -1, 1);
    expect(pos[0]).toBeGreaterThan(pos[2]);
    expect(neg[2]).toBeGreaterThan(neg[0]);
  });

  it('missing values are gray, and css text is rgb()', () => {
    expect(colorRgb(NaN, 'sequential', 0, 1)).toEqual([226, 232, 240]);
    expect(colorCss(0, 'diverging', -1, 1)).toBe('rgb(255,255,255)');
  });

  it('limits: natural range, fixed numbers, or the data', () => {
    const values = [0.2, 0.9, null, 0.5];
    expect(colorLimits('sequential', { values, natural: { lo: 0, hi: 1 } })).toEqual({
      lo: 0,
      hi: 1,
    });
    expect(
      colorLimits('sequential', { values, natural: { lo: 0, hi: 1 }, fixed: { lo: 0.2, hi: 0.9 } }),
    ).toEqual({ lo: 0.2, hi: 0.9 });
    expect(colorLimits('sequential', { values })).toEqual({ lo: 0, hi: 0.9 });
    expect(colorLimits('diverging', { values: [-0.4, 0.1] })).toEqual({ lo: -0.4, hi: 0.4 });
    expect(colorLimits('sequential', { values: [] })).toEqual({ lo: 0, hi: 1 });
  });
});

describe('ordering, paging and histogram', () => {
  const states = ['follow', 'Attack', 'rest'];
  it('orders as listed, by name, or by row mean', () => {
    expect(stateOrder(states, 'listed')).toEqual([0, 1, 2]);
    expect(stateOrder(states, 'name')).toEqual([1, 0, 2]);
    expect(stateOrder(states, 'mean', [0.2, 0.9, 0.5])).toEqual([1, 2, 0]);
  });

  it('row means leave out the diagonal and missing values', () => {
    const m = [1, 0.5, 0.3, 0.5, 1, null, 0.3, null, 1];
    expect(offDiagonalRowMeans(m, 3)).toEqual([0.4, 0.5, 0.3]);
  });

  it('pages tables at 100 rows', () => {
    const rows = Array.from({ length: 250 }, (_, i) => i);
    expect(pageCount(250)).toBe(3);
    expect(pageOf(rows, 0)).toHaveLength(100);
    expect(pageOf(rows, 2)).toHaveLength(50);
    expect(pageOf(rows, 9)[0]).toBe(200); // clamped to the last page
    expect(pageCount(0)).toBe(1);
  });

  it('bins values for the histogram without losing any', () => {
    const h = histogram([0, 0.1, 0.5, 0.9, 1], 4);
    expect(h.edges).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(h.counts).toEqual([2, 0, 1, 2]);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(5);
    expect(histogram([], 4).counts).toEqual([]);
  });

  it('round tick values', () => {
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.5, 1]);
    const t = niceTicks(0, 0.93, 5);
    expect(t[0]).toBe(0);
    expect(t.at(-1)!).toBeGreaterThanOrEqual(0.93); // the axis covers the data
  });
});

describe('csv rows', () => {
  it('pairs keep value, null range and p; missing values are empty', () => {
    const pairs: PairRow[] = [
      { a: 'follow', b: 'sniff', value: 0.9, nullLo: 0.1, nullHi: 0.4, p: 0.02 },
      { a: 'follow', b: 'rest', value: 0.2, nullLo: null, nullHi: null, p: null },
    ];
    const { header, rows } = pairsCsv(pairs);
    expect(header).toEqual(['state_a', 'state_b', 'value', 'null_low', 'null_high', 'p_value']);
    expect(rows[0]).toEqual(['follow', 'sniff', 0.9, 0.1, 0.4, 0.02]);
    expect(rows[1]).toEqual(['follow', 'rest', 0.2, '', '', '']);
  });

  it('per-state and matrix tables', () => {
    expect(perStateCsv(['a', 'b'], { r: [0.5, null] }).rows).toEqual([
      ['a', 0.5],
      ['b', ''],
    ]);
    expect(matrixCsv(['a', 'b'], [1, 0.2, 0.2, 1]).rows).toEqual([
      ['a', 1, 0.2],
      ['b', 0.2, 1],
    ]);
  });
});
