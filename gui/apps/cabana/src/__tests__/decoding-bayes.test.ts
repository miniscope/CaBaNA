import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BAYES,
  buildFeatures,
  makeBayesDecoder,
  windowFrames,
  type BayesInput,
  type BayesParams,
} from '../lib/decode-bayes.ts';
import { labelShuffle } from '../lib/decode-shared.ts';
import { makeRng } from '../lib/placecells.ts';
import ref from './decoding_reference.json';

// decoding_reference.json holds what the Python framework returned for these inputs (made by
// make_decoding_reference.py). With the test window as the framework makes it (clipWindowToFold
// false) the browser version must give the same decoded state for every frame. Values that are
// medians or counts agree exactly; the posterior confidence agrees to 1e-9.

const nan = (a: (number | null)[]) => a.map((x) => (x === null ? NaN : x));
const [ny, nx] = ref.shape;
const nStates = ny * nx;
const centers = new Float64Array(nStates * 2);
for (let s = 0; s < nStates; s++) {
  centers[2 * s] = (s % nx) + 0.5;
  centers[2 * s + 1] = Math.floor(s / nx) + 0.5;
}
const flat = (a: unknown) => nan((a as (number | null)[][]).flat());
const position: BayesInput = {
  neural: Float64Array.from(flat(ref.neural)),
  cells: ref.cells,
  frames: ref.frames,
  fs: ref.fs,
  labels: Int32Array.from(ref.labels),
  mask: Uint8Array.from(ref.mask),
  nStates,
  shape: [ny, nx],
  centers,
};
const categorical: BayesInput = {
  neural: Float64Array.from(flat(ref.cat_neural)),
  cells: ref.cells,
  frames: ref.frames,
  fs: ref.fs,
  labels: Int32Array.from(ref.cat_labels),
  mask: new Uint8Array(ref.frames).fill(1),
  nStates: 4,
};
const toParams = (kw: Record<string, unknown>): BayesParams => ({
  ...DEFAULT_BAYES,
  likelihood: (kw.likelihood as BayesParams['likelihood']) ?? 'gaussian',
  sigma: (kw.sigma as BayesParams['sigma']) ?? 'per_state',
  windowS: (kw.window_s as number) ?? 0.25,
  smoothSigmaBins: (kw.smooth_sigma_bins as number) ?? 0,
  nFolds: (kw.n_folds as number) ?? 5,
  prior: (kw.prior as BayesParams['prior']) ?? 'occupancy',
  clipWindowToFold: false,
});
const same = (got: ArrayLike<number>, want: (number | null)[], digits = 9) => {
  const w = nan(want);
  expect(got.length).toBe(w.length);
  w.forEach((x, i) => {
    if (Number.isNaN(x)) expect(got[i], `index ${i}`).toBeNaN();
    else expect(got[i], `index ${i}`).toBeCloseTo(x, digits);
  });
};
interface Case {
  params: Record<string, unknown>;
  values: (number | null)[];
  confusion: (number | null)[][];
  decoded: number[];
  error: (number | null)[];
  n_frames: number[];
  error_overall: (number | null)[];
  accuracy_overall: (number | null)[];
  chance_error: (number | null)[];
  posterior_mean_confidence: (number | null)[];
}

function check(input: BayesInput, params: BayesParams, want: Case, labels?: Int32Array) {
  const out = makeBayesDecoder(input, params)(labels);
  expect(Array.from(out.decoded)).toEqual(want.decoded);
  expect(Array.from(out.nFrames)).toEqual(want.n_frames);
  same(out.values, want.values as (number | null)[]);
  same(out.confusion, (want.confusion as (number | null)[][]).flat());
  if (input.centers) {
    same(out.error, want.error as (number | null)[]);
    same([out.errorOverall], want.error_overall as (number | null)[]);
    same([out.chanceError], want.chance_error as (number | null)[]);
  }
  same([out.accuracyOverall], want.accuracy_overall as (number | null)[]);
  same([out.meanConfidence], want.posterior_mean_confidence as (number | null)[]);
}

describe('windowFrames', () => {
  it('uses the framework rule: odd width, halves round to even', () => {
    expect(windowFrames(0.25, 20)).toBe(5);
    expect(windowFrames(1, 20)).toBe(21);
    expect(windowFrames(0, 20)).toBe(1);
  });
});

describe('Bayesian decoder against the framework (window as the framework makes it)', () => {
  for (const [name, want] of Object.entries(ref.position))
    it(`position: ${name}`, () => check(position, toParams(want.params), want as unknown as Case));
  it('behaviors: Gaussian, pooled sigma, recall per state', () =>
    check(categorical, toParams(ref.categorical.params), ref.categorical as unknown as Case));
  it('behaviors: Poisson', () =>
    check(categorical, toParams(ref.categorical_poisson.params), ref.categorical_poisson as unknown as Case));
  it('shuffled labels give the framework result for the same block order', () => {
    const block = Math.round(ref.shuffle.block_s * ref.fs);
    const labels = labelShuffle(position.labels, position.mask, block, makeRng(0), ref.shuffle.order);
    check(position, toParams(ref.position.gauss_per_state.params), ref.shuffle.decode as unknown as Case, labels);
  });
});

describe('fold boundary rule (GUI departure from the framework)', () => {
  const params = toParams(ref.position.gauss_pooled_smooth.params);
  const fw = makeBayesDecoder(position, params)();
  const clipped = makeBayesDecoder(position, { ...params, clipWindowToFold: true })();
  const half = (windowFrames(params.windowS, ref.fs) - 1) / 2;

  it('changes the decoded state only for frames whose window reaches a fold boundary', () => {
    const { usedFrames: idx, folds } = clipped;
    let near = 0;
    let differ = 0;
    idx.forEach((t, j) => {
      // a used frame within `half` frames of a used frame of another fold
      let reaches = false;
      for (let k = Math.max(0, j - half * 2); k <= Math.min(idx.length - 1, j + half * 2); k++)
        if (folds[k] !== folds[j] && Math.abs(idx[k] - t) <= half) reaches = true;
      if (reaches) near++;
      else expect(clipped.decoded[t]).toBe(fw.decoded[t]);
      if (clipped.decoded[t] !== fw.decoded[t]) differ++;
    });
    expect(near).toBeGreaterThan(0);
    expect(differ).toBeLessThanOrEqual(near);
  });

  it('builds each test window from used frames of its own fold only', () => {
    const used = new Uint8Array(ref.frames);
    clipped.usedFrames.forEach((t) => (used[t] = 1));
    const f = buildFeatures(position, { ...params, clipWindowToFold: true }, used);
    let touching = 0;
    f.idx.forEach((t, j) => {
      let n = 0;
      const sum = new Float64Array(position.cells);
      f.idx.forEach((t2, k) => {
        if (Math.abs(t2 - t) > half || f.folds[k] !== f.folds[j]) return;
        n++;
        for (let c = 0; c < position.cells; c++) sum[c] += f.x[k * position.cells + c];
      });
      expect(f.count[j]).toBe(n);
      for (let c = 0; c < position.cells; c++) expect(f.sums[j * position.cells + c]).toBe(sum[c]);
      if (f.idx.some((t2, k) => f.folds[k] !== f.folds[j] && Math.abs(t2 - t) <= half)) touching++;
    });
    expect(touching).toBeGreaterThan(0); // the boundary case is exercised
  });
});

describe('quality on the simulated place cells', () => {
  it('decodes position better than always guessing the most occupied bin', () => {
    const out = makeBayesDecoder(position, toParams(ref.position.gauss_pooled_smooth.params))();
    expect(out.errorOverall).toBeLessThan(out.chanceError);
  });
});
