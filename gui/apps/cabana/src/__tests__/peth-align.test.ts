// Offset alignment and separate onset/offset correction are GUI additions: the framework aligns to onsets
// only and corrects across all behaviors of a cell. peth.test.ts still checks the framework's onset path.

import { describe, expect, it } from 'vitest';
import { analyzePeth, onsetReport, type PethInput, type PethParams, DEFAULT_PETH_PARAMS } from '../lib/peth.ts';

const fs = 10;
const frames = 200;
// bouts at frames 30-39, 60-69, 100-104 (gap 30 and 30 frames between them), 190-199 (to the session end)
const row = new Uint8Array(frames);
for (const [a, b] of [[30, 40], [60, 70], [100, 105], [190, 200]]) row.fill(1, a, b);
const input = (neural = new Float32Array(frames)): PethInput => ({
  neural,
  cells: 1,
  frames,
  fs,
  behaviors: row,
  nBehaviors: 1,
  mask: new Uint8Array(frames).fill(1),
});
const params = (over: Partial<PethParams> = {}): PethParams => ({
  ...DEFAULT_PETH_PARAMS,
  preS: 1,
  postS: 1,
  baselineS: [-1, 0],
  responseS: [0, 1],
  minDurationS: 0,
  minGapS: 0,
  minEvents: 1,
  ...over,
});

describe('offset alignment', () => {
  it('the offset is the first frame after the bout', () => {
    const [r] = onsetReport(input(), params(), 'offset');
    expect([...r.onsets]).toEqual([40, 70, 105]);
    expect(r.edge).toBe(1); // the last bout ends at the session end: its window runs past it
  });
  it('onset alignment is unchanged', () => {
    const [r] = onsetReport(input(), params());
    expect([...r.onsets]).toEqual([30, 60, 100, 190]);
    expect(r.edge).toBe(0); // 190 + 10 frames of window ends exactly at the session end
  });
  it('the gap runs from this offset to the next onset; the last bout always passes', () => {
    // gaps to the next bout: 20 frames (2 s), 30 frames (3 s), 85 frames; the last bout has none
    const [r] = onsetReport(input(), params({ minGapS: 2.5 }), 'offset');
    expect(r.gap).toBe(1); // bout 1 is 2 s from the next one
    expect([...r.onsets]).toEqual([70, 105]);
  });
  it('the onset gap runs from the previous offset to this onset; the first bout always passes', () => {
    const [r] = onsetReport(input(), params({ minGapS: 2.5 }));
    expect(r.gap).toBe(1); // bout 2 starts 2 s after bout 1 ends
    expect([...r.onsets]).toEqual([30, 100, 190]);
  });
  it('an excluded bout still counts as the neighbor', () => {
    const [r] = onsetReport(input(), params({ minGapS: 2.5, minDurationS: 0.6 }), 'offset');
    // bout 3 (0.5 s) is too short; bout 2 is 3 s from it and passes the gap
    expect(r.short).toBe(1);
    expect([...r.onsets]).toEqual([40 + 30]);
  });
});

describe('separate families', () => {
  it('max-stat is corrected within each family, not across them', () => {
    const x = new Float32Array(frames);
    for (let t = 0; t < frames; t++) x[t] = Math.sin(t / 3);
    const two: PethInput = { ...input(x), behaviors: Uint8Array.from([...row, ...row]), nBehaviors: 2 };
    const p = params();
    const onsets = [Int32Array.from([30, 60, 100]), Int32Array.from([40, 70, 105])];
    const shifts = Int32Array.from({ length: 40 }, (_, i) => 20 + 3 * i);
    const together = analyzePeth(two, onsets, p, shifts, 'max_stat');
    const apart = analyzePeth(two, onsets, p, shifts, 'max_stat', undefined, [0, 1]);
    // each column alone in its family: the adjusted p-value equals the raw p-value
    expect([...apart.pAdj]).toEqual([...apart.pRaw]);
    expect(together.pAdj[0]).toBeGreaterThanOrEqual(together.pRaw[0]);
  });
});
