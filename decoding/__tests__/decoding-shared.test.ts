import { describe, expect, it } from 'vitest';
import {
  blockPermutation,
  exclusiveLabels,
  labelShuffle,
  overlapReport,
  rebin,
  roundHalfEven,
} from '../lib/decode-shared.ts';
import { makeRng } from '../lib/placecells.ts';
import ref from './decoding_reference.json';

// decoding_reference.json holds what the Python framework returned for these inputs (made by
// make_decoding_reference.py). The browser versions must give the same numbers.

const nan = (a: (number | null)[]) => a.map((x) => (x === null ? NaN : x));
const neural = Float64Array.from(nan((ref.neural as (number | null)[][]).flat()).map((x) => (Number.isNaN(x) ? 0 : x)));
const labels = Int32Array.from(ref.labels);
const mask = Uint8Array.from(ref.mask);

describe('roundHalfEven', () => {
  it('rounds halves to the even number, as Python does', () => {
    expect([0.5, 1.5, 2.5, 3.5, 2.4, 2.6].map(roundHalfEven)).toEqual([0, 2, 2, 4, 2, 3]);
  });
});

describe('rebin', () => {
  it('matches Session.rebin: summed neural data, 50% rule for labels and mask', () => {
    const r = rebin(neural, ref.cells, ref.frames, labels, mask, ref.shape[0] * ref.shape[1], ref.fs, 0.5);
    expect(r.k).toBe(ref.rebin.k);
    expect(r.frames).toBe(ref.frames / ref.rebin.k);
    const want = nan(ref.rebin.neural.flat() as (number | null)[]);
    r.neural.forEach((v, i) => expect(v).toBeCloseTo(want[i], 10));
    expect(Array.from(r.labels)).toEqual(ref.rebin.position);
    expect(Array.from(r.mask)).toEqual(ref.rebin.mask);
    expect(r.fs).toBe(ref.fs / ref.rebin.k);
  });
  it('rejects a bin shorter than one frame', () => {
    expect(() => rebin(neural, ref.cells, ref.frames, labels, mask, 20, ref.fs, 0.01)).toThrow();
  });
});

describe('exclusiveLabels', () => {
  const ex = ref.exclusive;
  const t = (i: number) => i / ex.fs;
  const names = ['a', 'b', 'c'];
  const rows = new Uint8Array(3 * ex.frames);
  for (const e of ex.epochs)
    for (let i = 0; i < ex.frames; i++)
      if (t(i) >= e.start && t(i) < e.stop) rows[names.indexOf(e.label) * ex.frames + i] = 1;
  const scored = Uint8Array.from({ length: ex.frames }, (_, i) =>
    t(i) >= ex.scored[0] && t(i) < ex.scored[1] ? 1 : 0,
  );
  it('matches BoutsToStates with priority order and a rest state', () => {
    const c = ex.cases.order_abc_rest;
    const got = exclusiveLabels(rows, ex.frames, c.behaviors.map((b) => names.indexOf(b)), true, scored);
    expect(Array.from(got)).toEqual(c.labels);
  });
  it('matches BoutsToStates with another priority order and no rest state', () => {
    const c = ex.cases.order_cba;
    const got = exclusiveLabels(rows, ex.frames, c.behaviors.map((b) => names.indexOf(b)), false);
    expect(Array.from(got)).toEqual(c.labels);
  });
  it('reports the overlap and the final frame counts', () => {
    const order = [0, 1, 2];
    const rep = overlapReport(rows, ex.frames, order, true, scored);
    const got = exclusiveLabels(rows, ex.frames, order, true, scored);
    const count = (s: number) => got.reduce((n, l) => n + (l === s ? 1 : 0), 0);
    expect(rep.final).toEqual([0, 1, 2, 3].map(count));
    expect(rep.won.reduce((a, b) => a + b, 0)).toBe(rep.labeled);
    // a (1-5 s) and b (2-4 s) overlap for 2 s; a (8-12 s) and c (9-11 s) for 2 s
    expect(rep.pairs).toContainEqual({ winner: 0, loser: 1, frames: 2 * ex.fs });
    expect(rep.pairs).toContainEqual({ winner: 0, loser: 2, frames: 2 * ex.fs });
    expect(rep.overlapping).toBe(4 * ex.fs);
  });
});

describe('labelShuffle', () => {
  const block = Math.max(1, roundHalfEven(ref.shuffle.block_s * ref.fs));
  it('matches LabelShuffle for the framework block order', () => {
    const got = labelShuffle(labels, mask, block, makeRng(0), ref.shuffle.order);
    expect(Array.from(got)).toEqual(ref.shuffle.labels);
  });
  it('keeps frames outside the mask and the number of masked frames per state', () => {
    const got = labelShuffle(labels, mask, block, makeRng(7));
    const count = (l: Int32Array) => {
      const c = new Map<number, number>();
      l.forEach((v, i) => mask[i] && c.set(v, (c.get(v) ?? 0) + 1));
      return [...c].sort((a, b) => a[0] - b[0]);
    };
    expect(count(got)).toEqual(count(labels));
    labels.forEach((v, i) => {
      if (!mask[i]) expect(got[i]).toBe(v);
    });
  });
  it('is a permutation of blocks, with a short last block', () => {
    expect(Array.from(blockPermutation(7, 3, [2, 0, 1]))).toEqual([6, 0, 1, 2, 3, 4, 5]);
  });
});
