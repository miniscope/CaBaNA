// What the Decoding screens show, worked out from a run: out-of-date checks, per-state rows and summary numbers.

import { prepChanges } from './prep-deps.ts';
import { overallStatistic } from './decode-test.ts';
import { behaviorOutcome, decodeOutcome, decodeSettings, type BehaviorOutcome, type DecodeOutcome } from './decoding-run.ts';

/** Preprocess settings changed since the last run, in words. Empty when there is no run or nothing changed. */
export function decodingChanges(): string[] {
  const o = decodeOutcome();
  return o ? prepChanges('decoding', o.prep, true) : [];
}

/** Settings that differ from the last run and would change its results; empty when there is no run. */
export function decodingSettingChanges(): string[] {
  const o = decodeOutcome();
  if (!o) return [];
  return JSON.stringify(o.settings) === JSON.stringify(decodeSettings) ? [] : ['decoding settings'];
}

export type StateStatus = 'significant' | 'not significant' | 'untested' | 'not evaluated';

export interface StateRow {
  state: number;
  /** Grid position of the bin, 0-based. */
  col: number;
  row: number;
  frames: number;
  /** Median decoding error in cm. */
  value: number;
  pRaw: number;
  pAdj: number;
  status: StateStatus;
}

/** One row per spatial bin the animal was in at least once; `not evaluated` for bins with too few frames. */
export function stateRows(o: DecodeOutcome): StateRow[] {
  const nx = o.data.frames.grid.nx;
  const alpha = o.settings.alpha;
  const rows: StateRow[] = [];
  o.observed.nFrames.forEach((frames, state) => {
    if (!frames) return;
    const value = o.observed.values[state];
    const kept = o.observed.valid[state] === 1 && Number.isFinite(value);
    const pRaw = o.test?.pRaw[state] ?? NaN;
    const pAdj = o.test?.pAdj[state] ?? NaN;
    const status: StateStatus = !kept
      ? 'not evaluated'
      : !o.test
        ? 'untested'
        : pAdj <= alpha
          ? 'significant'
          : 'not significant';
    rows.push({ state, col: state % nx, row: Math.floor(state / nx), frames, value: kept ? value : NaN, pRaw, pAdj, status });
  });
  return rows;
}

export interface Summary {
  usedFrames: number;
  decodedFrames: number;
  evaluated: number;
  notEvaluated: number;
  significant: number;
}

export function summarizeRun(o: DecodeOutcome): Summary {
  const rows = stateRows(o);
  return {
    usedFrames: o.observed.usedFrames.length,
    decodedFrames: o.observed.decoded.reduce((n, v) => n + (v >= 0 ? 1 : 0), 0),
    evaluated: rows.filter((r) => r.status !== 'not evaluated').length,
    notEvaluated: rows.filter((r) => r.status === 'not evaluated').length,
    significant: rows.filter((r) => r.status === 'significant').length,
  };
}

/** A p-value for display: its smallest possible value is 1 / (shuffles + 1), shown as "<". */
export function formatP(p: number, nShuffles: number): string {
  if (!Number.isFinite(p)) return '';
  const floor = 1 / (nShuffles + 1);
  return p <= floor + 1e-12 ? `< ${floor.toFixed(4).replace(/0+$/, '')}` : p.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

/** Settings that differ from the last behavior run; empty when there is no run. Behavior decoding reads no Preprocess value that can change. */
export function behaviorSettingChanges(): string[] {
  const o = behaviorOutcome();
  if (!o) return [];
  return JSON.stringify(o.settings) === JSON.stringify(decodeSettings) ? [] : ['decoding settings'];
}

export interface BehaviorRow {
  state: number;
  name: string;
  /** Frames of this state after overlaps are resolved. */
  frames: number;
  /** Recall: the share of its frames decoded as this state. */
  value: number;
  /** 95th percentile of the shuffled recalls, the upper edge of the null range. */
  nullHi: number;
  pRaw: number;
  pAdj: number;
  status: StateStatus;
}

const percentile = (v: number[], q: number) => {
  const a = Float64Array.from(v).sort();
  if (!a.length) return NaN;
  const pos = q * (a.length - 1);
  const lo = Math.floor(pos);
  return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * (pos - lo);
};

/** One row per state; `not evaluated` for states with too few frames. */
export function behaviorRows(o: BehaviorOutcome): BehaviorRow[] {
  const ns = o.data.names.length;
  return o.data.names.map((name, state) => {
    const value = o.observed.values[state];
    const kept = o.observed.valid[state] === 1 && Number.isFinite(value);
    const pAdj = o.test?.pAdj[state] ?? NaN;
    let nullHi = NaN;
    if (o.nullValues) {
      const col: number[] = [];
      for (let i = 0; i < o.nullValues.length / ns; i++) {
        const v = o.nullValues[i * ns + state];
        if (Number.isFinite(v)) col.push(v);
      }
      nullHi = percentile(col, 0.95);
    }
    const status: StateStatus = !kept
      ? 'not evaluated'
      : !o.test
        ? 'untested'
        : pAdj <= o.settings.alpha
          ? 'significant'
          : 'not significant';
    return { state, name, frames: o.observed.nFrames[state], value: kept ? value : NaN, nullHi, pRaw: o.test?.pRaw[state] ?? NaN, pAdj, status };
  });
}

/** Balanced accuracy (mean recall over the evaluated states), the overall statistic, and counts. */
export function summarizeBehavior(o: BehaviorOutcome) {
  const rows = behaviorRows(o);
  return {
    balancedAccuracy: overallStatistic(o.observed, false),
    chance: 1 / Math.max(1, rows.filter((r) => r.status !== 'not evaluated').length),
    labeledFrames: o.observed.usedFrames.length,
    decodedFrames: o.observed.decoded.reduce((n, v) => n + (v >= 0 ? 1 : 0), 0),
    evaluated: rows.filter((r) => r.status !== 'not evaluated').length,
    notEvaluated: rows.filter((r) => r.status === 'not evaluated').length,
    significant: rows.filter((r) => r.status === 'significant').length,
  };
}

/** The confusion matrix as shares of each true state's frames, rows true and columns decoded; NaN for dropped states. */
export function confusionShares(o: BehaviorOutcome): Float64Array {
  const n = o.data.names.length;
  const c = o.observed.confusion;
  const out = new Float64Array(n * n).fill(NaN);
  for (let r = 0; r < n; r++) {
    let tot = 0;
    for (let d = 0; d < n; d++) if (Number.isFinite(c[r * n + d])) tot += c[r * n + d];
    if (tot > 0) for (let d = 0; d < n; d++) if (Number.isFinite(c[r * n + d])) out[r * n + d] = c[r * n + d] / tot;
  }
  return out;
}
