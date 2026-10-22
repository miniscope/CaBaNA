import { describe, expect, it } from 'vitest';
import {
  analyzeAuroc,
  maxStatAdjust,
  observedAuroc,
  pTwoSided,
  responseOf,
  selectAurocMinShift,
  shiftedAurocCell,
  averageRanks,
  type AurocInput,
} from '../lib/auroc.ts';
import ref from './auroc_reference.json';

// auroc_reference.json holds what the Python framework returned for these inputs
// (made by make_auroc_reference.py). The browser versions must give the same numbers.

const nan = (a: (number | null)[]) => a.map((x) => (x === null ? NaN : x));
const same = (got: ArrayLike<number>, want: (number | null)[], digits = 12) => {
  const w = nan(want);
  expect(got.length).toBe(w.length);
  w.forEach((x, i) => {
    if (Number.isNaN(x)) expect(got[i], `index ${i}`).toBeNaN();
    else expect(got[i], `index ${i}`).toBeCloseTo(x, digits);
  });
};

const nb = ref.states;
const make = (mask: number[]): AurocInput => ({
  neural: Float64Array.from(nan(ref.neural)),
  cells: ref.cells,
  frames: ref.frames,
  fs: ref.fs,
  behaviors: Uint8Array.from(ref.onehot.flat()),
  nBehaviors: nb,
  mask: Uint8Array.from(mask),
});

for (const key of ['masked', 'all'] as const) {
  const r = ref[key];
  const input = make(r.mask);
  // shifted auROC for every cell, from the shifts the framework drew
  const nullDraws = Array.from({ length: ref.n_shuffles * ref.cells * nb });
  const perCell = Array.from({ length: ref.cells }, (_, c) => shiftedAurocCell(input, c, r.shifts));
  perCell.forEach((v, c) =>
    r.shifts.forEach((_, i) => {
      for (let b = 0; b < nb; b++) nullDraws[(i * ref.cells + c) * nb + b] = v[i * nb + b];
    }),
  );
  const observed = observedAuroc(input);
  const nullOf = (c: number) =>
    Float64Array.from(perCell[c]); // shuffles x behaviors for cell c
  const pRaw = Float64Array.from(observed, (o, k) => {
    const c = Math.floor(k / nb);
    const b = k % nb;
    return pTwoSided(
      o,
      Array.from({ length: ref.n_shuffles }, (_, i) => nullOf(c)[i * nb + b]),
    );
  });
  const pAdj = new Float64Array(observed.length);
  for (let c = 0; c < ref.cells; c++)
    pAdj.set(
      maxStatAdjust(observed.subarray(c * nb, (c + 1) * nb), nullOf(c), pRaw.subarray(c * nb, (c + 1) * nb)),
      c * nb,
    );

  describe(`auROC, ${key} frames kept`, () => {
    it('observed auROC', () => same(observed, r.observed));
    it('shifted auROC for the same shifts', () => same(nullDraws as number[], r.null));
    it('two-sided p-values from the same null', () => same(pRaw, r.p, 15));
    it('max-stat adjusted p-values from the same null', () => same(pAdj, r.p_adj, 15));
    it('never below the raw p, and the minimum is 2 / (n + 1)', () => {
      pAdj.forEach((a, k) => {
        if (!Number.isNaN(a)) expect(a).toBeGreaterThanOrEqual(pRaw[k]);
      });
      expect(Math.min(...pRaw.filter((p) => !Number.isNaN(p)))).toBeGreaterThanOrEqual(
        2 / (ref.n_shuffles + 1),
      );
    });
  });
}

describe('analyzeAuroc end to end', () => {
  it('gives the framework p-values and adjusted p-values from its shifts', () => {
    const r = analyzeAuroc(make(ref.masked.mask), ref.masked.shifts, 'max_stat');
    same(r.pRaw, ref.masked.p, 15);
    same(r.pAdj, ref.masked.p_adj, 15);
  });
});

describe('auROC details', () => {
  it('average ranks match scipy.rankdata with ties', () =>
    expect(Array.from(averageRanks([3, 1, 3, 2, 3]))).toEqual([4, 1, 4, 2, 4]));
  it('a NaN cell stays Not evaluated, a NaN in an excluded gap does not', () => {
    const o = observedAuroc(make(ref.masked.mask));
    for (let b = 0; b < nb - 1; b++) {
      expect(o[14 * nb + b]).toBeNaN();
      expect(o[15 * nb + b]).not.toBeNaN();
    }
  });
  it('a behavior with too few frames is not tested', () => {
    expect(ref.masked.n_in_state[3]).toBeLessThan(20);
    expect(observedAuroc(make(ref.masked.mask))[3]).toBeNaN();
  });
  it('response labels', () => {
    expect(responseOf(0.7, 0.01, 0.05)).toBe('excited');
    expect(responseOf(0.3, 0.01, 0.05)).toBe('inhibited');
    expect(responseOf(0.7, 0.2, 0.05)).toBe('not significant');
    expect(responseOf(NaN, 0.01, 0.05)).toBe('not evaluated');
  });
  it('automatic minimum shift', () => {
    const t = selectAurocMinShift(make(ref.masked.mask));
    expect(t.tauNeuralS).toBeCloseTo(ref.acf.cell_taus.length ? median(nan(ref.acf.cell_taus)) : NaN, 9);
    expect(t.tauBehaviorS).toBeCloseTo(ref.acf.behavior_tau, 9);
  });
});

function median(v: number[]) {
  const s = v.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

import { acceptShifts, balanceOf, fillMissing, matchGroups } from '../lib/speed-match.ts';
import { makeRng } from '../lib/placecells.ts';

describe('speed-matched null', () => {
  const sp = ref.speed;
  const input = make(ref.masked.mask);
  const speed = fillMissing(nan(sp.speed));
  const { groups } = matchGroups(input.behaviors, nb, input.mask, 50);
  it('matches the three behaviors with enough frames, not the rare one', () => {
    expect(groups.length).toBe(sp.n_groups);
  });
  for (const stat of ['ks', 'mean'] as const) {
    it(`balance statistic (${stat}) for fixed shifts`, () => {
      const got = sp.shifts.flatMap((k) => Array.from(balanceOf(speed, groups, k, stat)));
      same(got, sp[stat].balance, 12);
    });
    it(`accepts the same shifts as the framework (${stat})`, () => {
      const r = sp[stat];
      const opts = { statistic: stat, tolerance: r.tolerance, maxTries: 20, minFrames: 50 };
      const d = acceptShifts(speed, groups, r.order, 30, opts, makeRng(0));
      expect(Array.from(d.shifts)).toEqual(r.accepted);
      expect(d.acceptanceRate).toBeCloseTo(r.stats.acceptance_rate, 12);
      expect(d.candidates).toBe(r.stats.n_candidates);
      expect(d.balanceMax).toBeCloseTo(r.stats.balance_max, 12);
      expect(d.balanceMean).toBeCloseTo(r.stats.balance_mean, 12);
    });
  }
  it('stops with an error instead of falling back to an unmatched null', () => {
    const opts = { statistic: 'ks' as const, tolerance: 0.001, maxTries: 20, minFrames: 50 };
    expect(() => acceptShifts(speed, groups, sp.ks.order, 30, opts, makeRng(0))).toThrow(/accepted 0/);
  });
});
