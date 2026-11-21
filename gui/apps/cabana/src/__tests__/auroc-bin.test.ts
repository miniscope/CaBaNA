import { describe, expect, it } from 'vitest';
import {
  medianBoutFrames,
  rebinAuroc,
  suggestAurocBin,
  zeroFraction,
  type BinInput,
} from '../lib/auroc-bin.ts';
import { observedAuroc } from '../lib/auroc.ts';

/** Seeded generator, so the simulated sessions are fixed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

/** `cells` cells at `rateHz` events/s, 5x inside 2 s cues every 12 s; dense = add a small value to every frame. */
function session(cells: number, rateHz: number, dense = false): BinInput {
  const fs = 20;
  const frames = 20 * 600;
  const r = rng(1);
  const behaviors = new Uint8Array(frames);
  for (let t = 0; t < frames; t++) behaviors[t] = t % 240 < 40 ? 1 : 0;
  const neural = new Float32Array(cells * frames);
  for (let c = 0; c < cells; c++)
    for (let t = 0; t < frames; t++) {
      const p = (rateHz / fs) * (behaviors[t] ? 5 : 1);
      neural[c * frames + t] = (r() < p ? 1 + r() : 0) + (dense ? 0.01 + r() * 0.01 : 0);
    }
  return {
    neural,
    cells,
    frames,
    fs,
    behaviors,
    nBehaviors: 1,
    mask: new Uint8Array(frames).fill(1),
  };
}

describe('rebinAuroc', () => {
  it('sums events and keeps a behavior in bins it fills at least half of', () => {
    const m: BinInput = {
      neural: Float32Array.from([1, 0, 2, 0, 0, 3, 0]),
      cells: 1,
      frames: 7,
      fs: 10,
      behaviors: Uint8Array.from([1, 1, 1, 0, 0, 0, 1]),
      nBehaviors: 1,
      mask: Uint8Array.from([1, 1, 0, 0, 1, 1, 1]),
      speed: Float64Array.from([1, 3, NaN, 5, 2, 2, 9]),
    };
    const b = rebinAuroc(m, 0.2); // 2 frames per bin, the 7th frame is dropped
    expect(b.k).toBe(2);
    expect(b.frames).toBe(3);
    expect(b.fs).toBe(5);
    expect(Array.from(b.neural)).toEqual([1, 2, 3]);
    expect(Array.from(b.behaviors)).toEqual([1, 1, 0]);
    expect(Array.from(b.mask)).toEqual([1, 0, 1]);
    expect(Array.from(b.speed!)).toEqual([2, 5, 2]);
  });
  it('leaves out bins that are partly in a compared behavior', () => {
    const m: BinInput = {
      neural: Float32Array.from([1, 0, 2, 0, 0, 3, 4, 4]),
      cells: 1,
      frames: 8,
      fs: 10,
      // row 0: bin 0 pure in, bin 1 mixed, bin 2 pure out, bin 3 mixed; row 1 mixed only in bin 2
      behaviors: Uint8Array.from([1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0]),
      nBehaviors: 2,
      mask: new Uint8Array(8).fill(1),
    };
    const one = rebinAuroc(m, 0.2, [0]);
    expect(Array.from(one.mask)).toEqual([1, 0, 1, 0]);
    expect(one.mixed).toBe(2);
    expect(Array.from(rebinAuroc(m, 0.2, [0, 1]).mask)).toEqual([1, 0, 0, 0]);
    expect(Array.from(rebinAuroc(m, 0.2).mask)).toEqual([1, 1, 1, 1]);
  });
  it('refuses a bin that leaves fewer than two bins', () => {
    expect(() => rebinAuroc(session(1, 1), 1000)).toThrow(/too long/);
  });
});

describe('bin suggestion', () => {
  it('measures bouts and zeros', () => {
    const m = session(5, 0.5);
    expect(medianBoutFrames(m, 0)).toBe(40);
    expect(zeroFraction(m, 1)).toBeGreaterThan(0.9);
    expect(zeroFraction(m, 20)).toBeLessThan(zeroFraction(m, 1));
  });
  it('bins sparse events, capped at a third of the shortest bout', () => {
    const s = suggestAurocBin(session(20, 0.5), [0]);
    expect(s.maxS).toBeCloseTo(2 / 3);
    expect(s.binS).toBeGreaterThan(0);
    expect(s.binS).toBeLessThanOrEqual(2 / 3);
  });
  it('keeps frames for dense data', () => {
    const s = suggestAurocBin(session(5, 0.5, true), [0]);
    expect(s).toMatchObject({ binS: 0, reason: 'dense' });
  });
  it('raises the auROC of responding cells', () => {
    const m = session(20, 0.5);
    const asInput = (x: BinInput) => ({ ...x, neural: Float64Array.from(x.neural) });
    const med = (a: Float64Array) => [...a].sort((p, q) => p - q)[a.length >> 1];
    const frames = med(observedAuroc(asInput(m)));
    const bins = med(observedAuroc(asInput(rebinAuroc(m, suggestAurocBin(m, [0]).binS, [0]))));
    expect(bins).toBeGreaterThan(frames + 0.1);
  });
});
