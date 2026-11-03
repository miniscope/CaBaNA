import { describe, expect, it } from 'vitest';
import { DEFAULT_BAYES, makeBayesDecoder, usedFrameMask } from '../lib/decode-bayes.ts';
import { FOLD_CASES, foldBoundaries, foldSpans } from '../lib/fold-strip.ts';

describe('fold strip', () => {
  it('boundaries cover every frame once', () => {
    for (const [n, k] of FOLD_CASES) {
      const b = foldBoundaries(n, k);
      expect(b[0]).toBe(0);
      expect(b.at(-1)).toBe(n);
      expect(b.every((v, i) => i === 0 || v >= b[i - 1])).toBe(true);
    }
  });
  it('writes the boundaries for the Python parity test', async () => {
    const out = Object.fromEntries(FOLD_CASES.map(([n, k]) => [`${n},${k}`, foldBoundaries(n, k)]));
    await expect(JSON.stringify(out, null, 1) + '\n').toMatchFileSnapshot('./fixtures/fold-boundaries.json');
  });
  it('gap spans stay inside the recording', () => {
    const times = Array.from({ length: 1000 }, (_, t) => t / 10);
    const spans = foldSpans(times, 0.1, 100, 5, 1);
    expect(spans[0].gapBeforeS).toEqual([0, 0]);
    expect(spans[4].gapAfterS).toEqual([100, 100]);
    expect(spans[1].gapBeforeS).toEqual([19, 20]);
  });
  it("draws the decoder's own folds when frames are left out", () => {
    // 200 frames at 10 Hz; frames 50-99 are masked out, so the folds cover 150 used frames
    const frames = 200;
    const fs = 10;
    const mask = Uint8Array.from({ length: frames }, (_, t) => (t >= 50 && t < 100 ? 0 : 1));
    const labels = Int32Array.from({ length: frames }, (_, t) => Math.floor(t / 10) % 2);
    const neural = Float64Array.from({ length: 2 * frames }, (_, i) => (i % 7 === 0 ? 1 : 0));
    const m = { neural, cells: 2, frames, fs, labels, mask, nStates: 2 };
    const p = { ...DEFAULT_BAYES, nFolds: 4, minFramesPerClass: 1 };
    const out = makeBayesDecoder(m, p)();
    const { used } = usedFrameMask(m, labels, p.minFramesPerClass);
    const times: number[] = [];
    used.forEach((u, t) => u && times.push(t / fs));
    const spans = foldSpans(times, 1 / fs, frames / fs, p.nFolds, 0);
    out.usedFrames.forEach((t, j) => {
      const s = spans[out.folds[j]];
      expect(t / fs).toBeGreaterThanOrEqual(s.startS);
      expect(t / fs).toBeLessThan(s.stopS);
    });
    // the second fold starts after the masked frames, not at a quarter of the session
    expect(spans[1].startS).toBeCloseTo(times[Math.ceil(150 / 4)]);
    expect(spans[1].startS).not.toBeCloseTo(frames / fs / 4);
  });
});
