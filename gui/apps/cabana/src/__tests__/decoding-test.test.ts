import { describe, expect, it } from 'vitest';
import { DEFAULT_BAYES, makeBayesDecoder, type BayesInput } from '../lib/decode-bayes.ts';
import {
  decodeTest,
  maxStatP,
  overallStatistic,
  pTail,
  runShuffles,
  shuffledLabels,
  type Tail,
} from '../lib/decode-test.ts';
import ref from './decoding_reference.json';

// decoding_reference.json holds the framework's `_p_values` and `_max_stat_p` for a fixed null
// (made by make_decoding_reference.py): ties, a very wide null, a state undefined on some
// shuffles. p-values come from counts and must agree to 12 digits.

const nan = (a: (number | null)[]) => a.map((x) => (x === null ? NaN : x));
const obs = Float64Array.from(nan(ref.pvalues.observed));
const nullFlat = Float64Array.from(nan((ref.pvalues.null as (number | null)[][]).flat()));
const nStates = obs.length;

describe('p-values and max-stat correction against the framework', () => {
  for (const tail of ['lower', 'upper'] as Tail[]) {
    const want = ref.pvalues.tails[tail];
    it(`${tail} tail: raw p`, () => {
      const got = Array.from(obs, (o, s) =>
        pTail(o, Float64Array.from({ length: nullFlat.length / nStates }, (_, i) => nullFlat[i * nStates + s]), tail),
      );
      nan(want.p_raw).forEach((w, s) => expect(got[s]).toBeCloseTo(w, 12));
    });
    it(`${tail} tail: max-stat adjusted p`, () => {
      const got = maxStatP(obs, nullFlat, tail, Float64Array.from(nan(want.p_raw)));
      nan(want.p_adj).forEach((w, s) => expect(got[s]).toBeCloseTo(w, 12));
    });
  }
  it('decodeTest returns the same p-values and leaves them uncorrected with "none"', () => {
    const r = decodeTest(obs, 0.6, nullFlat, new Float64Array(0), 'lower', 'max_stat');
    nan(ref.pvalues.tails.lower.p_adj).forEach((w, s) => expect(r.pAdj[s]).toBeCloseTo(w, 12));
    const none = decodeTest(obs, 0.6, nullFlat, new Float64Array(0), 'lower', 'none');
    expect(Array.from(none.pAdj)).toEqual(Array.from(none.pRaw));
  });
});

const flat = (a: unknown) => nan((a as (number | null)[][]).flat());
const [ny, nx] = ref.shape;
const centers = new Float64Array(ny * nx * 2);
for (let s = 0; s < ny * nx; s++) {
  centers[2 * s] = (s % nx) + 0.5;
  centers[2 * s + 1] = Math.floor(s / nx) + 0.5;
}
const position: BayesInput = {
  neural: Float64Array.from(flat(ref.neural)),
  cells: ref.cells,
  frames: ref.frames,
  fs: ref.fs,
  labels: Int32Array.from(ref.labels),
  mask: Uint8Array.from(ref.mask),
  nStates: ny * nx,
  shape: [ny, nx],
  centers,
};
const params = { ...DEFAULT_BAYES, windowS: 0.5, smoothSigmaBins: 1 };

describe('shuffle test on the simulated place cells', () => {
  const nShuf = 30;
  const seed = 3;
  const { values, overall } = runShuffles(position, params, 1, seed, 0, nShuf);
  const observed = makeBayesDecoder(position, params)();
  const obsOverall = overallStatistic(observed, true);

  it('finds the planted position code: overall median error below every shuffle', () => {
    const r = decodeTest(observed.values, obsOverall, values, overall, 'lower', 'max_stat');
    expect(r.pOverall).toBeCloseTo(1 / (nShuf + 1), 12);
    expect(Math.min(...overall)).toBeGreaterThan(obsOverall);
  });
  it('shuffled labels carry no position: a shuffled run is not better than the shuffle null', () => {
    const labels = shuffledLabels(position.labels, position.mask, 20, seed, 999);
    const dec = makeBayesDecoder({ ...position, labels }, params)();
    const fake = decodeTest(dec.values, overallStatistic(dec, true), values, overall, 'lower', 'max_stat');
    expect(fake.pOverall).toBeGreaterThan(0.05);
  });
  it('gives the same shuffles whatever the split across workers', () => {
    const a = runShuffles(position, params, 1, seed, 0, 6);
    const b = runShuffles(position, params, 1, seed, 3, 6);
    expect(Array.from(b.overall)).toEqual(Array.from(a.overall.slice(3)));
    expect(Array.from(b.values)).toEqual(Array.from(a.values.slice(3 * position.nStates)));
  });
  it('only evaluated states have p-values', () => {
    const r = decodeTest(observed.values, obsOverall, values, overall, 'lower', 'none');
    observed.values.forEach((v, s) => expect(Number.isNaN(v)).toBe(Number.isNaN(r.pRaw[s])));
  });
});
