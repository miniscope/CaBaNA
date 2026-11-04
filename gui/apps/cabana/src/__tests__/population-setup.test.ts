import { describe, expect, it } from 'vitest';
import { DEFAULT_POPULATION, type PopulationSettings } from '../lib/population-settings.ts';
import {
  dimensionalityText,
  matrixLine,
  maxStatNote,
  methodSummaries,
  stabilityBlocks,
  stabilityLine,
  statsTable,
} from '../panels/population/setup-logic.ts';

const settings = (o: Partial<PopulationSettings> = {}): PopulationSettings => ({
  ...structuredClone(DEFAULT_POPULATION),
  ...o,
  methods: { ...DEFAULT_POPULATION.methods, ...o.methods },
});

describe('stability blocks', () => {
  it('cuts the used frames into equal contiguous blocks, even to half A and odd to half B', () => {
    const b = stabilityBlocks(100, 4);
    expect(b.map((x) => [x.start, x.end, x.half])).toEqual([
      [0, 25, 'A'],
      [25, 50, 'B'],
      [50, 75, 'A'],
      [75, 100, 'B'],
    ]);
  });
  it('matches the framework fold id floor(i * blocks / n) for an uneven count', () => {
    const n = 10;
    const k = 3;
    const spans = stabilityBlocks(n, k);
    for (let i = 0; i < n; i++) {
      const s = spans.find((x) => i >= x.start && i < x.end)!;
      expect(s.block).toBe(Math.floor((i * k) / n));
    }
    expect(spans.at(-1)!.end).toBe(n);
  });
  it('always has at least 2 blocks', () => {
    expect(stabilityBlocks(10, 1)).toHaveLength(2);
  });
});

describe('statistics table', () => {
  it('states what each analysis is compared on, and the status', () => {
    const rows = statsTable(
      settings({ methods: { ...DEFAULT_POPULATION.methods, pairwise: true } }),
      3,
    );
    const by = Object.fromEntries(rows.map((r) => [r.method, r]));
    expect(by.similarity.comparisons).toBe('3 state pairs');
    expect(by.stability.comparisons).toBe('3 states');
    expect(by.dimensionality.comparisons).toBe('Whole session');
    expect(by.pairwise.status).toBe('descriptive');
    expect(by.similarity.status).toBe('uncorrected');
    expect(by.stability.nullText).toBe('Circular cell shift, 200 shuffles');
  });
  it('max-stat corrects stability and per-state participation only', () => {
    const rows = statsTable(settings({ correction: 'max_stat', perStateParticipation: true }), 3);
    const by = Object.fromEntries(rows.map((r) => [r.method, r]));
    expect(by.stability.status).toBe('corrected');
    expect(by.dimensionality.status).toBe('corrected');
    expect(by.similarity.status).toBe('uncorrected');
    expect(by.separation.status).toBe('uncorrected');
  });
  it('the note appears only with max-stat, beside rows it does not cover', () => {
    const s = settings({ correction: 'max_stat' });
    const rows = statsTable(s, 3);
    expect(
      maxStatNote(
        s,
        rows.find((r) => r.method === 'similarity')!,
      ),
    ).toMatch(/only/);
    expect(
      maxStatNote(
        s,
        rows.find((r) => r.method === 'stability')!,
      ),
    ).toBeUndefined();
    const none = settings();
    expect(maxStatNote(none, statsTable(none, 3)[0])).toBeUndefined();
  });
  it('drops unselected methods', () => {
    const rows = statsTable(
      settings({ methods: { ...DEFAULT_POPULATION.methods, similarity: false } }),
      3,
    );
    expect(rows.some((r) => r.method === 'similarity')).toBe(false);
  });
});

describe('setup summary', () => {
  it('lists the selected methods with their main settings', () => {
    const t = methodSummaries(settings());
    expect(t).toHaveLength(4);
    expect(t[2]).toBe('State separation (PCA, 10 components, euclidean)');
  });
});

describe('result summaries', () => {
  const pair = (p: number | null) => ({ a: 'a', b: 'b', value: 1, nullLo: null, nullHi: null, p });
  it('counts state pairs below alpha', () => {
    const v = {
      states: [],
      values: {} as never,
      label: '',
      pairs: [pair(0.01), pair(0.2), pair(0.05)],
    };
    expect(matrixLine(v, 0.05, 'above the null').text).toBe(
      '2 of 3 state pairs above the null (p ≤ 0.05, uncorrected)',
    );
    expect(matrixLine({ ...v, pairs: [pair(null)] }, 0.05, 'x').tested).toBe(false);
  });
  it('uses adjusted p for a corrected stability result', () => {
    const v = {
      states: ['a', 'b'],
      r: [0.5, 0.4],
      nullLo: [],
      nullHi: [],
      p: [0.01, 0.01],
      pAdj: [0.01, 0.2],
      halves: () => ({ a: [], b: [] }),
      label: '',
    };
    expect(stabilityLine(v, 0.05, true).text).toBe(
      '1 of 2 states with adjusted p ≤ 0.05 (max-stat)',
    );
    expect(stabilityLine(v, 0.05, false).text).toContain('2 of 2');
  });
  it('shows the null and p of the participation ratio only when returned', () => {
    const base = { participationRatio: [12.34], nullLo: [null], nullHi: [null], p: [null] };
    expect(dimensionalityText(base, false)).toBe(
      'Participation ratio 12.3; no null returned, descriptive',
    );
    expect(dimensionalityText({ ...base, nullLo: [9], nullHi: [11], p: [0.02] }, false)).toBe(
      'Participation ratio 12.3; null 9 to 11; two-sided p 0.02',
    );
  });
});
