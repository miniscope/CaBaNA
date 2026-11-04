import { describe, expect, it } from 'vitest';
import type { AurocOutcome } from '../lib/auroc-run.ts';
import {
  aurocCardCounts,
  aurocCards,
  aurocHistogram,
  heatColor,
  heatHalfRange,
  isSingleBehavior,
  rankedByBehavior,
} from '../lib/auroc-population.ts';

const N = NaN;
/** A synthetic run: rows are cells, columns behaviors; alpha 0.05. */
function run(observed: number[][], pAdj: number[][]): AurocOutcome {
  const nb = observed[0].length;
  return {
    labels: Array.from({ length: nb }, (_, b) => `beh${b}`),
    cellIds: observed.map((_, i) => i),
    cellsMissing: [],
    info: [],
    result: {
      observed: Float64Array.from(observed.flat()),
      pRaw: Float64Array.from(pAdj.flat()),
      pAdj: Float64Array.from(pAdj.flat()),
    },
    settings: { alpha: 0.05 },
  } as unknown as AurocOutcome;
}

// Cell 0: higher for beh0, lower for beh1. Cell 1: higher for both. Cell 2: not significant.
// Cell 3: missing for everything. Cell 4: higher for beh0 only; beh1 missing.
const many = run(
  [
    [0.56, 0.44],
    [0.54, 0.53],
    [0.5, 0.51],
    [N, N],
    [0.52, N],
  ],
  [
    [0.01, 0.02],
    [0.01, 0.03],
    [0.6, 0.7],
    [N, N],
    [0.04, N],
  ],
);

describe('card counts', () => {
  it('counts unique responsive cells once, across behaviors', () => {
    const n = aurocCardCounts(many, 0);
    expect(n.responsive).toBe(3); // cells 0, 1, 4; cell 0 and 1 respond to two behaviors
    expect(n.evaluatedCells).toBe(4);
    expect(n.notEvaluatedCells).toBe(1);
    expect(n.totalCells).toBe(5);
  });
  it('follows the behavior filter for higher, lower and not significant', () => {
    const b0 = aurocCardCounts(many, 0);
    expect([b0.higher, b0.lower, b0.notSignificant]).toEqual([3, 0, 1]);
    expect(b0.evaluatedForBehavior).toBe(4);
    const b1 = aurocCardCounts(many, 1);
    expect([b1.higher, b1.lower, b1.notSignificant]).toEqual([1, 1, 1]);
    expect(b1.evaluatedForBehavior).toBe(3);
    expect(b1.notEvaluatedForBehavior).toBe(2);
  });
  it('adds up with one behavior', () => {
    const one = run([[0.56], [0.44], [0.5], [N]], [[0.01], [0.02], [0.5], [N]]);
    const n = aurocCardCounts(one, 0);
    expect(n.responsive).toBe(n.higher + n.lower);
    expect(n.higher + n.lower + n.notSignificant).toBe(n.evaluatedForBehavior);
    expect(n.evaluatedForBehavior + n.notEvaluatedForBehavior).toBe(n.totalCells);
    expect(isSingleBehavior(one)).toBe(true);
    expect(isSingleBehavior(many)).toBe(false);
  });
  it('states denominators and the behavior on the cards', () => {
    const cards = aurocCards(many, 1);
    expect(cards.map((c) => c.tone)).toEqual(['blue', 'orange', 'purple', 'gray']);
    expect(cards[0].value).toBe('3');
    expect(cards[0].denom).toContain('of 4 cells evaluated');
    expect(cards[0].denom).toContain('1 not evaluated');
    expect(cards[1].label).toBe('Higher activity · beh1');
    expect(cards[1].denom).toContain('1 of 3 cells evaluated for beh1');
    expect(cards[3].denom).toContain('2 not evaluated');
    expect(cards.map((c) => c.label).join(' ')).not.toMatch(/excited|inhibited/i);
  });
  it('handles a run with nothing evaluated', () => {
    const none = run([[N], [N]], [[N], [N]]);
    const n = aurocCardCounts(none, 0);
    expect([n.responsive, n.evaluatedForBehavior]).toEqual([0, 0]);
    expect(aurocCards(none, 0)[1].denom).toContain('–');
  });
});

describe('heatmap color range', () => {
  it('is set by the largest deviation, rounded up to 0.01', () => {
    expect(heatHalfRange(many)).toBe(0.06);
  });
  it('ignores missing values and has a floor', () => {
    expect(heatHalfRange(run([[N], [0.5]], [[N], [1]]))).toBe(0.01);
  });
  it('is symmetric: equal deviations are equally far from the middle color', () => {
    const mid = heatColor(0.5, 0.06);
    const hi = heatColor(0.56, 0.06);
    const lo = heatColor(0.44, 0.06);
    expect(hi).toBe('rgb(242,140,30)');
    expect(lo).toBe('rgb(106,61,184)');
    expect(mid).toBe('rgb(238,236,234)');
    // A small effect is visibly colored, not near gray
    expect(heatColor(0.53, 0.06)).not.toBe(mid);
  });
  it('uses gray only for a missing value', () => {
    expect(heatColor(N, 0.06)).toBe('#d0d0d0');
  });
});

describe('histogram and ranking', () => {
  it('bins evaluated cells for the behavior by response', () => {
    const bins = aurocHistogram(many, 0, 0.06, 12);
    const total = bins.reduce((s, b) => s + b.higher + b.lower + b.notSignificant, 0);
    expect(total).toBe(4);
    expect(bins.reduce((s, b) => s + b.higher, 0)).toBe(3);
    expect(bins[0].from).toBeCloseTo(0.44);
    expect(bins[11].to).toBeCloseTo(0.56);
    // 0.56 falls in the last bin, 0.44 in the first
    expect(bins[11].higher).toBe(1);
  });
  it('ranks by auROC with not evaluated last', () => {
    expect(rankedByBehavior(many, 0)).toEqual([0, 1, 4, 2, 3]);
  });
});
