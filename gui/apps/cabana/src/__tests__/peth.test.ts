import { describe, expect, it } from 'vitest';
import {
  analyzePeth,
  bouts,
  DEFAULT_PETH_PARAMS,
  observedPeth,
  onsetReport,
  pethCurves,
  pethGeometry,
  pethNullBand,
  pethResponse,
  shiftedPethCell,
  windowProblems,
  wilcoxonSignedRank,
  type PethInput,
  type PethParams,
} from '../lib/peth.ts';
import ref from './peth_reference.json';

// peth_reference.json holds what the Python framework and scipy returned for these inputs
// (made by make_peth_reference.py). The browser versions must give the same numbers.
// Sums are added in a different order than numpy does, so values agree to about 1e-15; the
// checks use 12 digits. p-values come from counts and must agree to 15 digits.

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
const input: PethInput = {
  neural: Float64Array.from(nan(ref.neural)),
  cells: ref.cells,
  frames: ref.frames,
  fs: ref.fs,
  behaviors: Uint8Array.from(ref.onehot.flat()),
  nBehaviors: nb,
  mask: Uint8Array.from(ref.mask),
};
const params = (binS: number | null, baselineSubtract: boolean): PethParams => ({
  preS: ref.params.pre_s,
  postS: ref.params.post_s,
  baselineS: ref.params.baseline_s as [number, number],
  responseS: ref.params.response_s as [number, number],
  binS,
  minDurationS: ref.params.min_duration_s,
  minGapS: ref.params.min_gap_s,
  minEvents: ref.params.min_events,
  baselineSubtract,
});
const subInput: PethInput = {
  ...input,
  cells: ref.sub.length,
  neural: Float64Array.from(ref.sub.flatMap((c) => Array.from(input.neural.subarray(c * input.frames, (c + 1) * input.frames)))),
};
const p0 = params(0.25, true);
const report = onsetReport(input, p0);
const onsets = report.map((r) => r.onsets);

describe('onsets', () => {
  it('bouts equal the framework runs', () => {
    ref.bouts.forEach((r, b) => {
      const got = bouts(input.behaviors.subarray(b * input.frames, (b + 1) * input.frames));
      expect(Array.from(got.onsets)).toEqual(r.onsets);
      expect(Array.from(got.lengths)).toEqual(r.lengths);
    });
  });
  it('valid onsets equal the framework valid_onsets', () =>
    report.forEach((r, b) => expect(Array.from(r.onsets)).toEqual(ref.valid_onsets[b])));
  it('exclusion counts match and add up to the bouts', () => {
    report.forEach((r, b) => {
      const w = ref.report[b];
      expect([r.bouts, r.short, r.gap, r.outside, r.edge]).toEqual([w.bouts, w.short, w.gap, w.outside, w.edge]);
      expect(r.onsets.length + r.short + r.gap + r.outside + r.edge).toBe(r.bouts);
    });
  });
  it('no duration or gap filter excludes nothing for those reasons', () => {
    const open = onsetReport(input, { ...p0, minDurationS: 0, minGapS: 0 });
    open.forEach((r) => {
      expect(r.short).toBe(0);
      expect(r.gap).toBe(0);
    });
  });
});

describe('each exclusion reason, on a small case', () => {
  // 10 Hz, window 1 s before and after, minimum duration 0.5 s, minimum gap 0.3 s
  const small: PethParams = {
    ...DEFAULT_PETH_PARAMS,
    preS: 1,
    postS: 1,
    baselineS: [-1, 0],
    responseS: [0, 0.5],
    minDurationS: 0.5,
    minGapS: 0.3,
    minEvents: 1,
  };
  const run = (ones: [number, number][], maskOff: [number, number][] = []) => {
    const frames = 100;
    const behaviors = new Uint8Array(frames);
    for (const [a, b] of ones) behaviors.fill(1, a, b);
    const mask = new Uint8Array(frames).fill(1);
    for (const [a, b] of maskOff) mask.fill(0, a, b);
    const r = onsetReport({ neural: new Float64Array(frames), cells: 1, frames, fs: 10, behaviors, nBehaviors: 1, mask }, small)[0];
    return { ...r, onsets: Array.from(r.onsets) };
  };
  it('too short', () =>
    expect(run([[30, 34]])).toEqual({ bouts: 1, onsets: [], short: 1, gap: 0, outside: 0, edge: 0 }));
  it('long enough at exactly the minimum', () => expect(run([[30, 35]]).onsets).toEqual([30]));
  it('too close to the previous bout', () =>
    expect(run([[20, 30], [32, 40]])).toEqual({ bouts: 2, onsets: [20], short: 0, gap: 1, outside: 0, edge: 0 }));
  it('a gap of exactly the minimum is kept', () => expect(run([[20, 30], [33, 40]]).onsets).toEqual([20, 33]));
  it('the previous bout counts even when it was excluded', () =>
    expect(run([[20, 23], [24, 40]])).toEqual({ bouts: 2, onsets: [], short: 1, gap: 1, outside: 0, edge: 0 }));
  it('onset frame outside the mask', () =>
    expect(run([[30, 40]], [[30, 31]])).toEqual({ bouts: 1, onsets: [], short: 0, gap: 0, outside: 1, edge: 0 }));
  it('only the onset frame has to be inside the mask', () => expect(run([[30, 40]], [[31, 40]]).onsets).toEqual([30]));
  it('window beyond the session, at both ends', () =>
    expect(run([[9, 20], [91, 99]])).toEqual({ bouts: 2, onsets: [], short: 0, gap: 0, outside: 0, edge: 2 }));
  it('a bout starting at frame 0 is an edge, and the last valid onset is frame 90', () => {
    expect(run([[0, 10]]).edge).toBe(1);
    expect(run([[90, 100]]).onsets).toEqual([90]);
    expect(run([[91, 100]]).edge).toBe(1);
  });
  it('counts a bout once, under the first reason', () =>
    expect(run([[0, 3]], [[0, 1]])).toEqual({ bouts: 1, onsets: [], short: 1, gap: 0, outside: 0, edge: 0 }));
});

describe('window settings', () => {
  it('geometry rounds like Python (halves to even)', () => {
    const g = pethGeometry({ ...p0, preS: 0.125, postS: 0.375, baselineS: [-0.125, 0.125], responseS: [0.125, 0.375] }, 20);
    expect([g.pre, g.post, ...g.base, ...g.resp]).toEqual([2, 8, -2, 2, 2, 8]);
  });
  it('geometry of the test parameters', () => {
    expect(pethGeometry(p0, 20)).toEqual({ pre: 80, post: 80, base: [-80, -20], resp: [0, 30] });
  });
  it('the framework errors', () => {
    expect(() => pethGeometry({ ...p0, responseS: [1, 1] }, 20)).toThrow(/spans no frames/);
    expect(() => pethGeometry({ ...p0, responseS: [0, 5] }, 20)).toThrow(/must lie within/);
    expect(() => pethGeometry({ ...p0, baselineS: [-5, -1] }, 20)).toThrow(/must lie within/);
  });
  it('problems in plain words, none when valid', () => {
    expect(windowProblems(p0, 20)).toEqual([]);
    expect(windowProblems({ ...p0, responseS: [1, 1] }, 20)[0]).toMatch(/Response interval/);
    expect(windowProblems({ ...p0, baselineS: [-5, -1] }, 20)[0]).toMatch(/Baseline interval must lie within/);
    expect(windowProblems({ ...p0, postS: 0, binS: 0, minEvents: 0 }, 20).length).toBeGreaterThanOrEqual(3);
  });
});

describe('PETH statistic and circular-shift test', () => {
  const r = ref.shuffle;
  const observed = observedPeth(input, onsets, p0);
  it('observed values', () => same(observed, r.observed));
  it('a NaN anywhere in a cell makes the whole cell NaN, as in the framework', () => {
    for (const c of [14, 15]) for (let b = 0; b < nb; b++) expect(observed[c * nb + b]).toBeNaN();
    expect(observed[0]).not.toBeNaN();
  });
  it('a behavior with too few onsets is NaN for every cell', () => {
    expect(onsets[3].length).toBeLessThan(p0.minEvents);
    for (let c = 0; c < ref.cells; c++) expect(observed[c * nb + 3]).toBeNaN();
  });
  it('shifted statistic for fixed shifts, including negative and beyond the session', () => {
    const got = new Float64Array(r.fixed_shifts.length * ref.cells * nb);
    for (let c = 0; c < ref.cells; c++) {
      const v = shiftedPethCell(input, c, onsets, p0, r.fixed_shifts);
      r.fixed_shifts.forEach((_, i) => {
        for (let b = 0; b < nb; b++) got[(i * ref.cells + c) * nb + b] = v[i * nb + b];
      });
    }
    same(got, r.fixed_null);
  });
  it('shifted statistic for the 200 shifts of the framework', () => {
    // only the cells in null_cells are stored: shifts x cells x behaviors
    const got: number[] = [];
    const per = r.null_cells.map((c) => shiftedPethCell(input, c, onsets, p0, r.shifts));
    r.shifts.forEach((_, i) => per.forEach((v) => got.push(...v.subarray(i * nb, (i + 1) * nb))));
    same(got, r.null);
  });
  it('p-values and max-stat adjusted p-values from the same shifts', () => {
    const a = analyzePeth(input, onsets, p0, r.shifts, 'max_stat');
    same(a.observed, r.observed);
    same(a.pRaw, r.p, 15);
    same(a.pAdj, r.p_adj, 15);
    a.pAdj.forEach((v, k) => {
      if (!Number.isNaN(v)) expect(v).toBeGreaterThanOrEqual(a.pRaw[k]);
    });
  });
  it('without correction the adjusted p is the raw p', () => {
    const a = analyzePeth(input, onsets, p0, r.shifts, 'none');
    same(a.pAdj, r.p, 15);
  });
  it('does not depend on bin size or baseline subtraction', () => {
    same(observedPeth(input, onsets, params(null, false)), r.observed);
  });
});

describe('curves and null band', () => {
  for (const [key, p] of [
    ['binned', params(0.25, true)],
    ['perframe', params(null, false)],
  ] as const) {
    const r = ref[key];
    // the per-frame curves are stored for the cells in `sub` only
    const x = key === 'perframe' ? subInput : input;
    const c = pethCurves(x, onsets, p);
    describe(`${key}`, () => {
      it('bin count and centres', () => {
        expect(c.bins).toBe(r.bins);
        same(c.timeS, r.time_s);
      });
      it('curve, standard error and onset counts', () => {
        same(c.peth, r.peth);
        same(c.sem, r.peth_sem);
        same(c.nEvents, r.n_events);
      });
      it('pre/post p-values', () => same(c.pPrePost, r.p_prepost, 12));
      for (const [L, w] of Object.entries(r.band) as [string, Record<string, (number | null)[]>][]) {
        it(`null band and latency, ${L} bins in a row`, () => {
          const b = pethNullBand(x, onsets, p, ref.band_shifts, Number(L), c);
          same(b.latencyS, w.latency_s);
          if (w.peth_null_lo) {
            same(b.lo, w.peth_null_lo);
            same(b.hi, w.peth_null_hi);
            same(b.mean, w.peth_null_mean);
          }
        });
      }
    });
  }
  it('the band computes the curves itself when none are given', () => {
    const b = pethNullBand(input, onsets, p0, ref.band_shifts, 2);
    same(b.latencyS, ref.binned.band['2'].latency_s);
  });
  it('some cells have a latency and some do not', () => {
    const lat = nan(ref.binned.band['2'].latency_s);
    expect(lat.some((v) => Number.isFinite(v))).toBe(true);
    expect(lat.some((v) => Number.isNaN(v))).toBe(true);
  });
  it('a NaN outside every window leaves the curves intact, a NaN inside a window does not', () => {
    const c = pethCurves(input, onsets, p0);
    const curve = (cell: number) => c.peth.slice(cell * nb * c.bins, (cell * nb + 1) * c.bins);
    expect(curve(15).every(Number.isFinite)).toBe(true);
    expect(curve(14).some(Number.isNaN)).toBe(true);
  });
});

describe('Wilcoxon signed-rank test', () => {
  it('equals scipy for every branch of method="auto"', () => {
    for (const w of ref.wilcoxon) expect(wilcoxonSignedRank(w.d), `${w.name}, n=${w.d.length}`).toBeCloseTo(w.p, 12);
  });
  it('covers the exact, permutation and normal-approximation branches', () => {
    const sizes = new Set(ref.wilcoxon.map((w) => w.d.length));
    expect([...sizes].some((n) => n <= 13)).toBe(true);
    expect([...sizes].some((n) => n > 50)).toBe(true);
    expect(ref.wilcoxon.some((w) => w.d.includes(0) && w.d.length > 13 && w.d.length <= 50)).toBe(true);
  });
  it('NaN for a NaN value or no non-zero value', () => {
    expect(wilcoxonSignedRank([1, 2, NaN, 4, 5, 6, 7])).toBeNaN();
    expect(wilcoxonSignedRank([0, 0, 0])).toBeNaN();
  });
});

describe('response labels', () => {
  it('uses the sign of the value', () => {
    expect(pethResponse(0.4, 0.01, 0.05)).toBe('excited');
    expect(pethResponse(-0.4, 0.01, 0.05)).toBe('inhibited');
    expect(pethResponse(0.4, 0.2, 0.05)).toBe('not significant');
    expect(pethResponse(0, 0.01, 0.05)).toBe('not significant');
    expect(pethResponse(NaN, 0.01, 0.05)).toBe('not evaluated');
    expect(pethResponse(0.4, NaN, 0.05)).toBe('not evaluated');
  });
});
