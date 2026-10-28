import { describe, expect, it } from 'vitest';
import {
  analyzePeth,
  DEFAULT_PETH_PARAMS,
  onsetReport,
  pethCurves,
  pethNullBand,
  type PethInput,
  type PethParams,
} from '../lib/peth.ts';
import type { PethOutcome } from '../lib/peth-run.ts';
import {
  behaviorReason,
  binFrames,
  boutTimeline,
  clipLimit,
  curveOf,
  filterCells,
  labelAt,
  meanOverCells,
  niceLimit,
  peakTimeS,
  rawWindows,
  sortCells,
  summarize,
  timeDomain,
  whyNotEvaluated,
} from '../lib/peth-view.ts';
import { drawShifts, makeRng } from '../lib/placecells.ts';

// 3 cells, 600 frames at 10 Hz, 2 behaviors. Cell 0 jumps after every onset of behavior 0, cell 1 is
// small noise, cell 2 has a missing value. Behavior 1 has only 2 bouts, below the minimum of 3.
const [fs, frames] = [10, 600];
const params: PethParams = {
  ...DEFAULT_PETH_PARAMS,
  preS: 2,
  postS: 2,
  baselineS: [-2, -1],
  responseS: [0, 1],
  binS: 0.2,
  minDurationS: 0.5,
  minGapS: 0.5,
};
const starts = [[100, 200, 300, 400, 500], [150, 350]];
const behaviors = new Uint8Array(2 * frames);
starts.forEach((row, b) => row.forEach((s) => behaviors.fill(1, b * frames + s, b * frames + s + 10)));
const neural = new Float32Array(3 * frames);
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let t = 0; t < frames; t++) {
  neural[frames + t] = 0.1 * rnd();
  neural[2 * frames + t] = 0.1 * rnd();
  neural[t] = 0.05 * rnd() + (starts[0].some((s) => t >= s && t < s + 10) ? 5 : 0);
}
neural[2 * frames + 5] = NaN;
const input: PethInput = { neural, cells: 3, frames, fs, behaviors, nBehaviors: 2, mask: new Uint8Array(frames).fill(1) };
const reports = onsetReport(input, params);
const onsets = reports.map((r) => r.onsets);
const shifts = drawShifts(frames, 100, 50, makeRng(0)).shifts;
const curves = pethCurves(input, onsets, params);
const out = {
  labels: ['Investigation', 'Mounting'],
  cellIds: [0, 1, 2],
  input,
  reports,
  onsets,
  params,
  result: analyzePeth(input, onsets, params, shifts, 'max_stat'),
  curves,
  band: pethNullBand(input, onsets, params, shifts, 2, curves),
  cellsMissing: [2],
  shifts,
  columns: [{ b: 0, align: 'onset' }, { b: 1, align: 'onset' }],
  settings: { test: 'circular', alpha: 0.05, align: 'onset' },
} as unknown as PethOutcome;

describe('PETH views', () => {
  it('binning and time axis follow the curves', () => {
    expect(binFrames(out)).toBe(2);
    const [lo, hi] = timeDomain(out);
    expect(lo).toBeCloseTo(-2.05);
    expect(hi).toBeCloseTo(1.95);
    expect(out.curves.timeS[0]).toBeCloseTo(lo + 0.1);
  });
  it('raw windows are the stored trace around each onset', () => {
    const w = rawWindows(out, 0, 0);
    expect([w.rows, w.cols]).toEqual([5, 40]);
    expect(w.data[0]).toBe(neural[100 - 20]);
    expect(w.data[2 * 40 + 39]).toBe(neural[300 - 20 + 39]);
  });
  it('says why a behavior or a cell has no value', () => {
    expect(behaviorReason(out, 0)).toBeUndefined();
    expect(behaviorReason(out, 1)).toBe('2 bouts, minimum 3');
    expect(whyNotEvaluated(out, 2, 0)).toMatch(/non-finite/);
    expect(whyNotEvaluated(out, 0, 1)).toBe('2 bouts, minimum 3');
    expect(whyNotEvaluated(out, 0, 0)).toBeUndefined();
  });
  it('sorts the responding cell first and cells without a value last', () => {
    expect(sortCells(out, 0, 'response')[0]).toBe(0);
    expect(sortCells(out, 0, 'response').at(-1)).toBe(2);
    // peak time: the highest point of the mean curve over the whole window (framework `plot_peth_data`)
    const { mean } = curveOf(out, 0, 0);
    expect(peakTimeS(out, 0, 0)).toBe(out.curves.timeS[mean.indexOf(Math.max(...mean))]);
    expect(sortCells(out, 0, 'latency')).toHaveLength(3);
  });
  it('counts labels and not evaluated cells', () => {
    const s = summarize(out);
    expect(s).toMatchObject({ cells: 3, evaluated: 2, missingCells: 1 });
    expect(s.perBehavior[0].counts.excited).toBe(1);
    expect(s.perBehavior[0].counts['not evaluated']).toBe(1);
    expect(s.perBehavior[1].counts['not evaluated']).toBe(3);
    expect(s.perBehavior[1].reason).toBeDefined();
  });
  it('rounds the color limit up to a round number', () => {
    expect([0.37, 1.2, 0.05, 0, 7].map(niceLimit)).toEqual([0.4, 1.5, 0.05, 1, 8]);
    expect(clipLimit(out, 0)).toBeGreaterThanOrEqual(5);
    expect(clipLimit(out, 0)).toBeLessThanOrEqual(6);
  });
  it('averages curves over cells, with no SEM for one cell', () => {
    const [a, b] = [0, 1].map((c) => meanOverCells(out, 0, [c]));
    const both = meanOverCells(out, 0, [0, 1]);
    expect(both.mean[0]).toBeCloseTo((a.mean[0] + b.mean[0]) / 2);
    expect(a.sem.every(Number.isNaN)).toBe(true);
    expect(both.sem.every(Number.isFinite)).toBe(true);
  });
  it('marks excluded onsets on the timeline', () => {
    const d = { frames, fs, behaviors } as Parameters<typeof boutTimeline>[0];
    expect(boutTimeline(d, 1, reports[1]).map((e) => e.included)).toEqual([true, true]);
    const none = { ...reports[0], onsets: Int32Array.from([200]) };
    expect(boutTimeline(d, 0, none).map((e) => e.included)).toEqual([false, true, false, false, false]);
    expect(boutTimeline(d, 0, undefined).every((e) => e.included)).toBe(true);
    expect(boutTimeline(d, 0, none)[0]).toMatchObject({ startS: 10, lengthS: 1 });
  });
  it('the cell filter keeps only cells with that label for the behavior', () => {
    const all = sortCells(out, 0, 'response');
    expect(filterCells(out, 0, all, 'all')).toEqual(all);
    for (const f of ['excited', 'inhibited'] as const)
      expect(filterCells(out, 0, all, f).every((c) => labelAt(out, c, 0) === f)).toBe(true);
    expect(filterCells(out, 0, all, 'excited').length).toBe(all.filter((c) => labelAt(out, c, 0) === 'excited').length);
  });
});
