import { describe, expect, it } from 'vitest';
import {
  copyState,
  isDirty,
  markSaved,
  newDraft,
  recordEdit,
  undoEdit,
} from '../lib/arena-draft.ts';
import {
  copyName,
  moveRegion,
  regionBox,
  regionHandles,
  regionSizeText,
  resizeRegion,
  scaleFromLine,
  toCmFrom,
} from '../lib/arena-geometry.ts';

describe('draft', () => {
  it('steps back through edits and stops at the start', () => {
    let d = newDraft({ n: 0 });
    d = recordEdit(d, { n: 0 });
    d = recordEdit(d, { n: 1 });
    const a = undoEdit(d);
    expect(a.restore).toEqual({ n: 1 });
    const b = undoEdit(a.draft);
    expect(b.restore).toEqual({ n: 0 });
    expect(undoEdit(b.draft).restore).toBeUndefined();
  });
  it('is dirty only when the state differs from the start, and not after saving', () => {
    const d = newDraft({ zones: ['a'] });
    expect(isDirty(d, { zones: ['a'] })).toBe(false);
    expect(isDirty(d, { zones: ['a', 'b'] })).toBe(true);
    expect(isDirty(markSaved({ zones: ['a', 'b'] }), { zones: ['a', 'b'] })).toBe(false);
  });
  it('copies a state so later changes do not reach it', () => {
    const a = { z: [1] };
    const c = copyState(a);
    a.z.push(2);
    expect(c.z).toEqual([1]);
  });
});

describe('arena geometry', () => {
  it('gets px per cm from a line and a distance, in cm or mm', () => {
    expect(
      scaleFromLine(
        [
          [0, 0],
          [660, 0],
        ],
        60,
      ),
    ).toBeCloseTo(11);
    expect(
      scaleFromLine(
        [
          [0, 0],
          [660, 0],
        ],
        toCmFrom(600, 'mm'),
      ),
    ).toBeCloseTo(11);
    expect(scaleFromLine(undefined, 60)).toBeUndefined();
    expect(
      scaleFromLine(
        [
          [0, 0],
          [10, 0],
        ],
        0,
      ),
    ).toBeUndefined();
  });
  it('moves and resizes a rectangle, keeping the opposite corner', () => {
    const z = {
      shape: 'rect' as const,
      pts: [
        [10, 10],
        [30, 20],
      ] as [number, number][],
    };
    expect(moveRegion(z, 5, -5)).toEqual([
      [15, 5],
      [35, 15],
    ]);
    expect(resizeRegion(z, 2, [50, 40])).toEqual([
      [10, 10],
      [50, 40],
    ]);
    expect(resizeRegion(z, 0, [0, 0])).toEqual([
      [30, 20],
      [0, 0],
    ]);
    expect(regionHandles(z)).toHaveLength(4);
  });
  it('resizes a circle by its edge point and leaves a polygon alone', () => {
    const c = {
      shape: 'circle' as const,
      pts: [
        [10, 10],
        [14, 10],
      ] as [number, number][],
    };
    expect(resizeRegion(c, 0, [10, 20])).toEqual([
      [10, 10],
      [10, 20],
    ]);
    expect(regionBox(c)).toEqual({ x: 6, y: 6, w: 8, h: 8 });
    const p = {
      shape: 'polygon' as const,
      pts: [
        [0, 0],
        [4, 0],
        [0, 3],
      ] as [number, number][],
    };
    expect(resizeRegion(p, 0, [9, 9])).toBe(p.pts);
    expect(regionHandles(p)).toEqual([]);
  });
  it('writes size and area in cm', () => {
    expect(
      regionSizeText('rect', [
        [0, 0],
        [20, 30],
      ]),
    ).toBe('20.0 × 30.0 cm · 600.0 cm²');
    expect(
      regionSizeText('polygon', [
        [0, 0],
        [4, 0],
        [0, 3],
      ]),
    ).toBe('4.0 × 3.0 cm · 6.0 cm²');
    expect(
      regionSizeText('circle', [
        [0, 0],
        [1, 0],
      ]),
    ).toBe('diameter 2.0 cm · 3.1 cm²');
  });
  it('finds a free name for a copy', () => {
    const taken = new Set(['left copy']);
    expect(copyName('left', (n) => taken.has(n))).toBe('left copy 2');
    expect(copyName('right', (n) => taken.has(n))).toBe('right copy');
  });
});
