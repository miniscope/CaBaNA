import { describe, expect, it } from 'vitest';
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
    const spans = foldSpans(1000, 5, 10, 1);
    expect(spans[0].gapBeforeS).toEqual([0, 0]);
    expect(spans[4].gapAfterS).toEqual([100, 100]);
    expect(spans[1].gapBeforeS).toEqual([19, 20]);
  });
});
