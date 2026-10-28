// What the Decoding screens show, worked out from a run: out-of-date checks, per-state rows and summary numbers.

import { prepChanges } from './prep-deps.ts';
import { decodeOutcome, decodeSettings, type DecodeOutcome } from './decoding-run.ts';

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
