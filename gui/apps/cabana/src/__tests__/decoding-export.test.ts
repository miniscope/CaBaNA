import { describe, expect, it } from 'vitest';
import { DEFAULT_BAYES, makeBayesDecoder } from '../lib/decode-bayes.ts';
import { decodeTest, overallStatistic, runShuffles } from '../lib/decode-test.ts';
import {
  behaviorConfusionCsv,
  behaviorMetadata,
  behaviorStatesCsv,
  decodingBinsCsv,
  decodingFramesCsv,
  decodingMetadata,
} from '../lib/decoding-export.ts';
import { DEFAULT_DECODE_SETTINGS, type BehaviorOutcome, type DecodeOutcome } from '../lib/decoding-run.ts';
import { DEFAULT_PREP } from '../lib/preprocess.ts';
import { behaviorRows, confusionShares, formatP, stateRows, summarizeBehavior, summarizeRun } from '../lib/decoding-view.ts';
import ref from './decoding_reference.json';

const nan = (a: (number | null)[]) => a.map((x) => (x === null ? NaN : x));
const [ny, nx] = ref.shape;
const centers = new Float64Array(ny * nx * 2);
for (let s = 0; s < ny * nx; s++) {
  centers[2 * s] = ((s % nx) + 0.5) * 3;
  centers[2 * s + 1] = (Math.floor(s / nx) + 0.5) * 3;
}
const input = {
  neural: Float64Array.from(nan((ref.neural as (number | null)[][]).flat())),
  cells: ref.cells,
  frames: ref.frames,
  fs: ref.fs,
  labels: Int32Array.from(ref.labels),
  mask: Uint8Array.from(ref.mask),
  nStates: ny * nx,
  shape: [ny, nx] as [number, number],
  centers,
};
const params = { ...DEFAULT_BAYES, windowS: 0.5 };
const observed = makeBayesDecoder(input, params)();
const shuf = runShuffles(input, params, 1, 0, 0, 20);
const test = decodeTest(observed.values, overallStatistic(observed, true), shuf.values, shuf.overall, 'lower', 'max_stat');
const outcome = {
  target: 'position',
  data: {
    input,
    cellIds: Array.from({ length: ref.cells }, (_, i) => i),
    frames: { grid: { nx, ny, bin: 3, open: [] }, labels: input.labels, used: 0, minSpeed: 0 },
  },
  params,
  observed,
  test,
  nullValues: shuf.values,
  nullOverall: shuf.overall,
  blockFrames: 20,
  seconds: 1,
  settings: { ...structuredClone(DEFAULT_DECODE_SETTINGS), nShuffles: 20, blockS: 1 },
  prep: { ...DEFAULT_PREP },
  binCm: 3,
} as unknown as DecodeOutcome;

describe('decoding exports and summaries', () => {
  it('lists every visited bin and marks the rare ones Not evaluated', () => {
    const rows = stateRows(outcome);
    expect(rows.length).toBe(observed.nFrames.filter((n) => n > 0).length);
    const rare = rows.filter((r) => r.frames < params.minFramesPerClass);
    expect(rare.length).toBeGreaterThan(0);
    rare.forEach((r) => expect(r.status).toBe('not evaluated'));
    const sum = summarizeRun(outcome);
    expect(sum.evaluated + sum.notEvaluated).toBe(rows.length);
  });
  it('the bins CSV states the statistic, the test, the correction and the departures', () => {
    const csv = decodingBinsCsv(outcome);
    expect(csv).toContain('median decoding error in cm');
    expect(csv).toContain('Westfall-Young');
    expect(csv).toContain('GUI extension');
    expect(csv.split('\n').filter((l) => !l.startsWith('#')).length).toBe(1 + stateRows(outcome).length);
  });
  it('the frames CSV has one row per used frame', () => {
    const lines = decodingFramesCsv(outcome).split('\n').filter((l) => !l.startsWith('#'));
    expect(lines.length).toBe(1 + observed.usedFrames.length);
  });
  it('the metadata records the departures and that training folds supply every fitted parameter', () => {
    const m = decodingMetadata(outcome);
    expect(m.departures_from_framework.length).toBe(3);
    expect(m.decoder_settings.window_clipped_at_fold_boundary).toBe(true);
    expect(m.shuffle_test?.corrected_p_label).toBe('max-stat corrected');
  });
  it('formats the smallest possible p as a bound', () => {
    expect(formatP(1 / 1001, 1000)).toBe('< 0.001');
    expect(formatP(0.0452, 1000)).toBe('0.0452');
    expect(formatP(NaN, 1000)).toBe('');
  });
});

describe('behavior decoding results', () => {
  const catInput = {
    neural: Float64Array.from(nan((ref.cat_neural as (number | null)[][]).flat())),
    cells: ref.cells,
    frames: ref.frames,
    fs: ref.fs,
    labels: Int32Array.from(ref.cat_labels),
    mask: new Uint8Array(ref.frames).fill(1),
    nStates: 4,
  };
  const cp = { ...DEFAULT_BAYES, sigma: 'pooled' as const, windowS: 0.25 };
  const obs = makeBayesDecoder(catInput, cp)();
  const sh = runShuffles(catInput, cp, 1, 0, 0, 20);
  const bt = decodeTest(obs.values, overallStatistic(obs, false), sh.values, sh.overall, 'upper', 'max_stat');
  const out = {
    target: 'behavior',
    data: {
      input: catInput,
      cellIds: Array.from({ length: ref.cells }, (_, i) => i),
      names: ['A', 'B', 'C', 'D'],
      rowOf: [0, 1, 2, 3],
      overlap: { labeled: 0, overlapping: 5, won: [], lost: [], final: [1, 1, 1, 1], pairs: [{ winner: 0, loser: 1, frames: 5 }] },
      scoredFrames: ref.frames,
      fs: ref.fs,
    },
    params: cp,
    observed: obs,
    test: bt,
    nullValues: sh.values,
    nullOverall: sh.overall,
    blockFrames: 20,
    seconds: 1,
    settings: { ...structuredClone(DEFAULT_DECODE_SETTINGS), nShuffles: 20, blockS: 1 },
    prep: { ...DEFAULT_PREP },
  } as unknown as BehaviorOutcome;

  it('marks the rare behavior Not evaluated and gives the rest recall, a null range and p-values', () => {
    const rows = behaviorRows(out);
    expect(rows[3].status).toBe('not evaluated'); // 12 frames
    rows.slice(0, 3).forEach((r) => {
      expect(r.value).toBeGreaterThan(0.5);
      expect(r.nullHi).toBeLessThan(r.value);
      expect(r.pAdj).toBeGreaterThanOrEqual(r.pRaw);
    });
  });
  it('balanced accuracy is the mean recall over evaluated behaviors', () => {
    const s = summarizeBehavior(out);
    const mean = (obs.values[0] + obs.values[1] + obs.values[2]) / 3;
    expect(s.balancedAccuracy).toBeCloseTo(mean, 12);
    expect(s.evaluated).toBe(3);
  });
  it('confusion shares sum to one per evaluated row', () => {
    const c = confusionShares(out);
    for (let r = 0; r < 3; r++) {
      const sum = [0, 1, 2].reduce((a, d) => a + c[r * 4 + d], 0);
      expect(sum).toBeCloseTo(1, 12);
    }
    expect(c[3 * 4 + 0]).toBeNaN();
  });
  it('exports the statistic, the priority order, the correction and the departures', () => {
    const csv = behaviorStatesCsv(out);
    expect(csv).toContain('recall');
    expect(csv).toContain('A > B > C > D');
    expect(csv).toContain('Westfall-Young');
    expect(csv.split('\n').filter((l) => !l.startsWith('#')).length).toBe(1 + 4);
    expect(behaviorConfusionCsv(out).split('\n').length).toBe(2 + 4);
    const m = behaviorMetadata(out);
    expect(m.departures_from_framework.length).toBe(3);
    expect(m.decoder_settings.sigma).toBe('pooled');
    expect(m.shuffle_test?.tail).toBe('upper');
  });
});
