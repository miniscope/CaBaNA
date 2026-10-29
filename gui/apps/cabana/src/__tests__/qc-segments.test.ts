import { describe, expect, it } from 'vitest';
import { positionQc } from '../lib/qc.ts';
import { positionSegments } from '../lib/qc-segments.ts';
import type { Table } from '../lib/parse.ts';

// 200 frames, 20 ms apart. Frames 20 to 99 are lost (1.6 s); frame 150 jumps away and back.
const ts: Table = {
  columns: ['Frame Number', 'Time Stamp (ms)'],
  rows: Array.from({ length: 200 }, (_, i) => [String(i), String(i * 20)]),
};
const pos: Table = {
  columns: ['frame', 'x', 'y'],
  rows: Array.from({ length: 200 }, (_, i) => {
    const xy = i >= 20 && i < 100 ? [-1, -1] : i === 150 ? [50, 20] : [i * 0.01, 5];
    return [String(i), ...xy.map(String)];
  }),
};

describe('positionSegments', () => {
  it('lists one jump segment and one long lost stretch, in time order', () => {
    const p = positionQc(pos, ts, 60, { lostPct: 5, jumpPct: 0.02 });
    const s = positionSegments(p, 60);
    expect(s.map((g) => g.kind)).toEqual(['lost', 'jump']);
    expect(s[0]).toMatchObject({ first: 20, last: 99, n: 80, start: 0.4, stop: 1.98 });
    expect(s[1]).toMatchObject({ first: 149, last: 151, n: 2, start: 2.98, stop: 3.02 });
    expect(s[1].peak).toBeGreaterThan(60);
  });

  it('leaves out lost stretches under the limit', () => {
    const p = positionQc(pos, ts, 60, { lostPct: 5, jumpPct: 0.02 });
    expect(positionSegments(p, 60, 2).map((g) => g.kind)).toEqual(['jump']);
  });
});
