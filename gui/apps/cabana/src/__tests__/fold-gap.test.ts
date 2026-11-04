import { describe, expect, it } from 'vitest';
import {
  exclusionFrames,
  gapFrames,
  meanEventAutocorrelation,
  suggestSeparation,
} from '../lib/fold-gap.ts';

/** Deterministic pseudo-random numbers in [0, 1). */
function rand(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

describe('training/test separation', () => {
  it('leaves out the frames the framework does', () => {
    // [gap s, fs, Bayesian window s, framework fold_exclusion_frames]
    const cases: [number, number, number, number][] = [
      [1, 29.79, 0.25, 34],
      [0, 29.79, 0.25, 0],
      [2.5, 30, 1, 90],
      [0.01, 20, 0, 1],
      [1, 2, 0.25, 2],
      [0.3, 10, 0.5, 5],
    ];
    for (const [g, fs, w, want] of cases) expect(exclusionFrames(g, fs, w)).toBe(want);
    expect(gapFrames(1, 30)).toBe(30);
  });

  it('autocorrelation from event pairs equals the direct sum', () => {
    const r = rand(3);
    const cells = 4;
    const frames = 300;
    const neural = Float32Array.from({ length: cells * frames }, () => (r() < 0.1 ? r() : 0));
    const maxLag = 40;
    const got = meanEventAutocorrelation(neural, cells, frames, maxLag);
    const want = new Float64Array(maxLag + 1);
    for (let c = 0; c < cells; c++) {
      const x = Array.from({ length: frames }, (_, t): number =>
        neural[c * frames + t] > 0 ? 1 : 0,
      );
      const p = x.reduce((a, b) => a + b, 0) / frames;
      const ss = x.reduce((a, v) => a + (v - p) ** 2, 0);
      for (let k = 0; k <= maxLag; k++) {
        let s = 0;
        for (let t = 0; t + k < frames; t++) s += (x[t] - p) * (x[t + k] - p);
        want[k] += s / ss / cells;
      }
    }
    expect(got[0]).toBeCloseTo(1, 12);
    got.forEach((v, k) => expect(v).toBeCloseTo(want[k], 10));
  });

  it('suggests the lag where slowly varying activity decorrelates', () => {
    // events whose rate follows 20-frame on/off blocks: correlated within a block
    const r = rand(7);
    const cells = 20;
    const frames = 4000;
    const fs = 10;
    const neural = new Float32Array(cells * frames);
    for (let c = 0; c < cells; c++)
      for (let t = 0; t < frames; t++)
        neural[c * frames + t] = r() < (Math.floor(t / 20) % 2 ? 0.3 : 0.02) ? 1 : 0;
    const s = suggestSeparation(neural, cells, frames, fs);
    if ('error' in s) throw new Error(s.error);
    // a triangle that reaches zero near half the 40-frame period
    expect(s.decorrelationS).toBeGreaterThan(0.8);
    expect(s.decorrelationS).toBeLessThan(1.3);
    expect(s.suggestedS).toBeGreaterThanOrEqual(s.decorrelationS);
  });

  it('explains when no separation can be suggested', () => {
    const neural = new Float32Array(3 * 100).fill(1);
    expect('error' in suggestSeparation(neural, 3, 100, 10)).toBe(true);
  });
});
