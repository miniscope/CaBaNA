// Browser-engine decoding results in the shape of a framework results file, so the Decoding results
// page reads them with the same loaders as a framework run (decoding-results.ts). Names, extras and
// test arrays follow what the framework stores for `bayesian_decoder` and `decode_states`.

import type { Manifest, ManifestResult } from './bridge-client.ts';
import type { BayesOut } from './decode-bayes.ts';
import type { LinearOut } from './decode-linear.ts';
import type { DecodeTestResult, Tail } from './decode-test.ts';
import { DECODING_RESULT } from './decoding-results.ts';
import type { Nd, ResultSource } from './results-load.ts';

export interface EngineDump {
  manifest: Manifest;
  arrays: Record<string, Record<string, Nd>>;
}

/** The shuffle test of a run. `nullValues` is shuffles x states, `nullOverall` one value per shuffle. */
export interface EngineTest extends DecodeTestResult {
  nullValues: Float64Array;
  nullOverall: Float64Array;
  alpha: number;
  correction: 'max_stat' | 'none';
  blockS: number;
  tail: Tail;
}

const nd = (shape: number[], values: ArrayLike<number>): Nd => ({
  shape,
  data: Array.from(values, (v) => (Number.isFinite(v) ? v : null)),
});
const scalar = (v: number) => nd([1], [v]);

/** Framework numbering of the bins of an nx x ny grid is x-major; the engine numbers them y-major. */
export function frameworkOrder(nx: number, ny: number): Int32Array {
  const order = new Int32Array(nx * ny);
  for (let ix = 0; ix < nx; ix++)
    for (let iy = 0; iy < ny; iy++) order[ix * ny + iy] = iy * nx + ix;
  return order;
}
export function binNames(nx: number, ny: number): string[] {
  const pad = (i: number, n: number) => String(i).padStart(String(n - 1).length, '0');
  return Array.from(
    { length: nx * ny },
    (_, f) => `x${pad(Math.floor(f / ny), nx)}_y${pad(f % ny, ny)}`,
  );
}

/** numpy.nanpercentile of one state's null draws (linear interpolation). */
function nanPercentile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const h = (sorted.length - 1) * q;
  const lo = Math.floor(h);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (h - lo);
}

/** The `sh_*` arrays of the framework's shuffle test, states taken in `order` (engine index of each output state). */
export function shuffleTestArrays(
  observed: ArrayLike<number>,
  t: EngineTest,
  order: ArrayLike<number>,
): Record<string, Nd> {
  const ns = observed.length;
  const shuffles = t.nullValues.length / ns;
  const pick = (a: ArrayLike<number>) => Float64Array.from(order as ArrayLike<number>, (s) => a[s]);
  // One-sided bounds as the framework computes them: alpha and 1 - alpha for a one-tailed test.
  const lo = new Float64Array(ns);
  const hi = new Float64Array(ns);
  const median = new Float64Array(ns);
  const mean = new Float64Array(ns);
  const std = new Float64Array(ns);
  const draws = new Float64Array(shuffles * ns);
  for (let o = 0; o < ns; o++) {
    const col: number[] = [];
    for (let i = 0; i < shuffles; i++) {
      const v = t.nullValues[i * ns + order[o]];
      draws[i * ns + o] = v;
      if (Number.isFinite(v)) col.push(v);
    }
    col.sort((a, b) => a - b);
    lo[o] = nanPercentile(col, t.alpha);
    hi[o] = nanPercentile(col, 1 - t.alpha);
    median[o] = nanPercentile(col, 0.5);
    const m = col.reduce((s, v) => s + v, 0) / (col.length || NaN);
    mean[o] = m;
    std[o] =
      col.length > 1
        ? Math.sqrt(col.reduce((s, v) => s + (v - m) ** 2, 0) / (col.length - 1))
        : NaN;
  }
  const p = pick(t.pRaw);
  const pAdj = pick(t.pAdj);
  const flag = (a: Float64Array) =>
    Float64Array.from(a, (v) => (Number.isFinite(v) && v < t.alpha ? 1 : 0));
  return {
    sh_observed: nd([ns], pick(observed)),
    sh_p_value: nd([ns], p),
    sh_p_adj: nd([ns], pAdj),
    sh_null_lo: nd([ns], lo),
    sh_null_hi: nd([ns], hi),
    sh_null_median: nd([ns], median),
    sh_null_mean: nd([ns], mean),
    sh_null_std: nd([ns], std),
    sh_significant: nd([ns], flag(p)),
    sh_significant_adj: nd([ns], flag(pAdj)),
    sh_null: nd([shuffles, ns], draws),
  };
}

function manifestOf(
  name: string,
  meta: Pick<ManifestResult, 'metric' | 'target' | 'state_names' | 'params' | 'provenance'>,
  extras: string[],
  t: EngineTest,
): Manifest {
  return {
    format: 2,
    schema_version: '1.0.0',
    status: 'ok',
    results: [
      {
        name,
        level: 'population',
        cell_ids: null,
        plots: [],
        extras_by_name: Object.fromEntries(extras.map((e) => [e, e])),
        shuffle: {
          alpha: t.alpha,
          tail: t.tail,
          n_shuffles: t.nullOverall.length,
          null_name: 'label_shuffle',
          correction: t.correction,
          correction_scope: 'states',
          correction_note: '',
          null_info: { block_s: t.blockS },
        },
        ...meta,
      },
    ],
    errors: [],
    warnings: [],
  };
}

export interface PositionEngineInput {
  out: BayesOut;
  /** Grid columns and rows (x and y bins), in the engine's numbering. */
  nx: number;
  ny: number;
  params: Record<string, unknown>;
  test: EngineTest;
}

/** Position decoding as a framework `bayesian_decoder` result on a grid. */
export function positionDump(a: PositionEngineInput): EngineDump {
  const { out, nx, ny, test } = a;
  const n = nx * ny;
  const order = frameworkOrder(nx, ny);
  const inFramework = new Int32Array(n); // engine bin -> framework bin
  order.forEach((s, f) => (inFramework[s] = f));
  const pick = (v: ArrayLike<number>) => Float64Array.from(order, (s) => v[s]);
  const confusion = new Float64Array(n * n);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) confusion[r * n + c] = out.confusion[order[r] * n + order[c]];
  const decoded = Float64Array.from(out.decoded, (s) => (s < 0 ? -1 : inFramework[s]));
  const extras: Record<string, Nd> = {
    confusion: nd([n, n], confusion),
    decoded: nd([out.decoded.length], decoded),
    error: nd([out.error.length], out.error),
    error_overall: scalar(out.errorOverall),
    accuracy_overall: scalar(out.accuracyOverall),
    chance_error: scalar(out.chanceError),
    n_frames: nd([n], pick(out.nFrames)),
    posterior_mean_confidence: scalar(out.meanConfidence),
  };
  const name = DECODING_RESULT.position;
  return {
    manifest: manifestOf(
      name,
      {
        metric: 'bayesian_decoder',
        target: 'position',
        state_names: binNames(nx, ny),
        params: { name: 'bayesian_decoder', ...a.params },
        provenance: { target_shape: [nx, ny], target_kind: 'states', engine: 'browser' },
      },
      Object.keys(extras),
      test,
    ),
    arrays: {
      [name]: {
        values: nd([n], pick(out.values)),
        ...extras,
        ...shuffleTestArrays(out.values, test, order),
      },
    },
  };
}

export interface BehaviorEngineInput {
  names: string[];
  params: Record<string, unknown>;
  test: EngineTest;
}

/** Behavior decoding with the Bayesian decoder as a framework `bayesian_decoder` result on categories. */
export function behaviorBayesDump(a: BehaviorEngineInput & { out: BayesOut }): EngineDump {
  const { out, names } = a;
  const n = names.length;
  const extras: Record<string, Nd> = {
    confusion: nd([n, n], out.confusion),
    accuracy_overall: scalar(out.accuracyOverall),
    n_frames: nd([n], out.nFrames),
  };
  return behaviorDump('bayesian_decoder', names, out.values, extras, a);
}

/** Behavior decoding with logistic regression (one against the rest) as a framework `decode_states` result. */
export function behaviorLogisticDump(a: BehaviorEngineInput & { out: LinearOut }): EngineDump {
  const { out, names } = a;
  const n = names.length;
  const extras: Record<string, Nd> = {
    confusion: nd([n, 2, 2], out.confusion),
    accuracy_overall: scalar(out.overall),
    n_frames: nd([n], out.nFrames),
    chance: nd([n], new Float64Array(n).fill(0.5)),
  };
  return behaviorDump('decode_states', names, out.values, extras, a);
}

function behaviorDump(
  metric: string,
  names: string[],
  values: ArrayLike<number>,
  extras: Record<string, Nd>,
  a: BehaviorEngineInput,
): EngineDump {
  const name = DECODING_RESULT.behavior;
  const order = Int32Array.from(names, (_, i) => i);
  return {
    manifest: manifestOf(
      name,
      {
        metric,
        target: 'behavior',
        state_names: names,
        params: { name: metric, ...a.params },
        provenance: { target_kind: 'states', engine: 'browser' },
      },
      Object.keys(extras),
      a.test,
    ),
    arrays: {
      [name]: {
        values: nd([names.length], values),
        ...extras,
        ...shuffleTestArrays(values, a.test, order),
      },
    },
  };
}

/** The reader the results views use, over an in-memory dump. */
export function dumpSource(d: EngineDump): ResultSource {
  return {
    manifest: async () => d.manifest,
    array: async (result, key) => {
      const hit = d.arrays[result]?.[key];
      if (!hit) throw new Error(`no ${key}`);
      return hit;
    },
  };
}
