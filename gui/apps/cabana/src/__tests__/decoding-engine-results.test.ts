import { describe, expect, it } from 'vitest';
import { DEFAULT_BAYES, makeBayesDecoder, type BayesInput } from '../lib/decode-bayes.ts';
import { DEFAULT_LINEAR, decodeLinear, type LinearInput } from '../lib/decode-linear.ts';
import {
  decodeTest,
  overallStatistic,
  runLinearShuffles,
  runShuffles,
} from '../lib/decode-test.ts';
import {
  behaviorBayesDump,
  behaviorLogisticDump,
  binNames,
  dumpSource,
  frameworkOrder,
  positionDump,
  shuffleTestArrays,
  type EngineTest,
} from '../lib/decoding-engine-results.ts';
import { loadBehaviorDecoding, loadPositionDecoding } from '../lib/decoding-results.ts';
import { binCells } from '../panels/decoding/model.ts';
import { openFixture } from './fixture-source.ts';
import ref from './decoding_reference.json';

// The browser engine's output must read through the same loaders as a framework results file. The
// inputs are the framework reference inputs (a 5 x 4 grid, so the bin numbering is not symmetric).

const nan = (a: (number | null)[]) => a.map((x) => (x === null ? NaN : x));
const flat = (a: unknown) => nan((a as (number | null)[][]).flat());
const [ny, nx] = ref.shape;
const centers = new Float64Array(nx * ny * 2);
for (let s = 0; s < nx * ny; s++) {
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
  nStates: nx * ny,
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
const L = ref.linear;
const linear: LinearInput = {
  neural: Float64Array.from(flat(L.neural)),
  cells: ref.cells,
  frames: L.frames,
  fs: L.fs,
  labels: Int32Array.from(L.labels),
  mask: new Uint8Array(L.frames).fill(1),
  nStates: L.n_states,
};

const N_SHUFFLES = 20;
const withTest = (
  t: ReturnType<typeof decodeTest>,
  nullValues: Float64Array,
  nullOverall: Float64Array,
  tail: 'lower' | 'upper',
  correction: 'max_stat' | 'none' = 'max_stat',
): EngineTest => ({ ...t, nullValues, nullOverall, alpha: 0.05, correction, blockS: 1, tail });

/** A stored value reads back as null where the engine has NaN. */
const same = (got: number | null | undefined, want: number) =>
  Number.isNaN(want) ? expect(got ?? NaN).toBeNaN() : expect(got).toBeCloseTo(want, 12);

describe('numbering of position bins', () => {
  it('lists bins x-major, as the framework does, and names them like its bin_grid', () => {
    expect(Array.from(frameworkOrder(3, 2))).toEqual([0, 3, 1, 4, 2, 5]);
    expect(binNames(13, 13).slice(0, 3)).toEqual(['x00_y00', 'x00_y01', 'x00_y02']);
    expect(binNames(2, 3)).toEqual(['x0_y0', 'x0_y1', 'x0_y2', 'x1_y0', 'x1_y1', 'x1_y2']);
  });
});

describe('position result from the browser engine', () => {
  const params = { ...DEFAULT_BAYES, windowS: 0.5 };
  const out = makeBayesDecoder(position, params)();
  const { values, overall } = runShuffles(position, params, 1, 0, 0, N_SHUFFLES);
  const test = withTest(
    decodeTest(out.values, overallStatistic(out, true), values, overall, 'lower', 'max_stat'),
    values,
    overall,
    'lower',
  );
  const src = dumpSource(positionDump({ out, nx, ny, params: {}, test }));

  it('reads as a position decoding view with the overall numbers', async () => {
    const v = await loadPositionDecoding(src, await src.manifest());
    expect(v).toBeDefined();
    expect(v!.overall.value).toBeCloseTo(out.errorOverall, 12);
    expect(v!.overall.chance).toBeCloseTo(out.chanceError, 12);
    expect(v!.gridShape).toEqual([nx, ny]);
    expect(v!.bins).toHaveLength(nx * ny);
    expect(v!.frameError?.shape).toEqual([ref.frames]);
    expect(v!.tested?.nShuffles).toBe(N_SHUFFLES);
    expect(v!.tested?.tail).toBe('lower');
    expect(v!.label).toContain('label shuffle');
  });

  it('puts every value on the bin the map draws it in', async () => {
    const v = (await loadPositionDecoding(src, await src.manifest()))!;
    const cells = binCells(v)!;
    const order = frameworkOrder(nx, ny);
    cells.forEach((c, f) => {
      const s = order[f]; // engine bin of this map cell
      expect(c.col).toBe(s % nx);
      expect(c.row).toBe(Math.floor(s / nx));
      if (Number.isNaN(out.values[s])) expect(c.excluded).toBe(true);
      else expect(c.error).toBeCloseTo(out.values[s], 12);
      if (!c.excluded) expect(c.p).toBeCloseTo(test.pRaw[s], 12);
    });
  });

  it('keeps the confusion counts and per-frame decoded bins consistent', async () => {
    const m = await src.manifest();
    const name = m.results[0].name;
    const order = frameworkOrder(nx, ny);
    const conf = await src.array(name, 'confusion');
    const n = nx * ny;
    for (const [f, g] of [
      [0, 3],
      [7, 7],
      [n - 1, 1],
    ])
      same(conf.data[f * n + g], out.confusion[order[f] * n + order[g]]);
    const decoded = await src.array(name, 'decoded');
    const toEngine = new Map(Array.from(order, (s, f) => [f, s]));
    out.decoded.forEach((s, t) => {
      if (s >= 0) expect(toEngine.get(Number(decoded.data[t]))).toBe(s);
      else expect(decoded.data[t]).toBe(-1);
    });
  });
});

describe('behavior results from the browser engine', () => {
  const names = ['a', 'b', 'c', 'd'];
  it('Bayesian decoder: a confusion matrix and per-behavior recall with p-values', async () => {
    const out = makeBayesDecoder(categorical, { ...DEFAULT_BAYES, sigma: 'pooled' })();
    const { values, overall } = runShuffles(categorical, DEFAULT_BAYES, 1, 0, 0, N_SHUFFLES);
    const mean = overallStatistic(out, false);
    const test = withTest(
      decodeTest(out.values, mean, values, overall, 'upper', 'max_stat'),
      values,
      overall,
      'upper',
    );
    const src = dumpSource(behaviorBayesDump({ out, names, params: {}, test }));
    const v = await loadBehaviorDecoding(src, await src.manifest());
    expect(v).toBeDefined();
    expect(v!.states).toEqual(names);
    expect(v!.confusionKind).toBe('matrix');
    expect(v!.confusion?.shape).toEqual([4, 4]);
    expect(v!.overall.value).toBeCloseTo(out.accuracyOverall, 12);
    v!.score.forEach((x, i) => same(x, out.values[i]));
    v!.p.forEach((p, i) => expect(p === null).toBe(Number.isNaN(out.values[i])));
    v!.nullLo.forEach((lo, i) => lo !== null && expect(lo).toBeLessThanOrEqual(v!.nullHi[i]!));
    expect(v!.tested?.tail).toBe('upper');
  });

  it('logistic regression: one 2 x 2 table per behavior, chance 0.5', async () => {
    const params = { ...DEFAULT_LINEAR };
    const out = decodeLinear(linear, params);
    const { values, overall } = runLinearShuffles(linear, params, 1, 0, 0, N_SHUFFLES);
    const test = withTest(
      decodeTest(out.values, out.overall, values, overall, 'upper', 'none'),
      values,
      overall,
      'upper',
      'none',
    );
    const n = linear.nStates;
    const src = dumpSource(
      behaviorLogisticDump({ out, names: names.slice(0, n), params: {}, test }),
    );
    const v = await loadBehaviorDecoding(src, await src.manifest());
    expect(v).toBeDefined();
    expect(v!.confusionKind).toBe('one_vs_rest');
    expect(v!.confusion?.shape).toEqual([n, 2, 2]);
    expect(v!.overall.chance).toBe(0.5);
    expect(v!.overall.value).toBeCloseTo(out.overall, 12);
    expect(v!.tested?.correction).toBe('none');
  });
});

describe('same arrays as a framework run', () => {
  const [fix] = openFixture('bayes_position_open_field');
  const r = fix.manifest.results[0] as unknown as { extras: Record<string, string> };
  const fixArrays = fix.arrays.decoding_position;

  it('names the same extras and test arrays as the framework', () => {
    const out = makeBayesDecoder(position, DEFAULT_BAYES)();
    const { values, overall } = runShuffles(position, DEFAULT_BAYES, 1, 0, 0, 3);
    const test = withTest(
      decodeTest(out.values, 1, values, overall, 'lower', 'max_stat'),
      values,
      overall,
      'lower',
    );
    const mine = positionDump({ out, nx, ny, params: {}, test });
    const got = Object.keys(mine.arrays.decoding_position);
    for (const name of Object.values(r.extras)) expect(got, name).toContain(name);
    for (const key of Object.keys(fixArrays).filter((k) => k.startsWith('sh_')))
      expect(got, key).toContain(key);
  });

  it('computes the null bounds as the framework does (one-sided, alpha and 1 - alpha)', () => {
    const S = 169;
    const nul = fixArrays.sh_null;
    const t: EngineTest = {
      pRaw: Float64Array.from(nan(fixArrays.sh_p_value.data as (number | null)[])),
      pAdj: Float64Array.from(nan(fixArrays.sh_p_adj.data as (number | null)[])),
      overall: 0,
      pOverall: 1,
      nullValues: Float64Array.from(nan(nul.data as (number | null)[])),
      nullOverall: new Float64Array(nul.shape[0]),
      alpha: 0.05,
      correction: 'max_stat',
      blockS: 1,
      tail: 'lower',
    };
    const observed = Float64Array.from(nan(fixArrays.values.data as (number | null)[]));
    const mine = shuffleTestArrays(
      observed,
      t,
      Int32Array.from({ length: S }, (_, i) => i),
    );
    for (const key of [
      'sh_null_lo',
      'sh_null_hi',
      'sh_null_median',
      'sh_null_mean',
      'sh_null_std',
    ]) {
      const want = fixArrays[key].data as (number | null)[];
      const got = mine[key].data as (number | null)[];
      want.forEach((w, i) => {
        if (w === null) expect(got[i]).toBeNull();
        else expect(got[i]!, `${key}[${i}]`).toBeCloseTo(w, 4);
      });
    }
    // significance is p < alpha
    const sig = fixArrays.sh_significant.data as (number | null)[];
    sig.forEach((w, i) => expect(mine.sh_significant.data[i]).toBe(w));
  });
});
