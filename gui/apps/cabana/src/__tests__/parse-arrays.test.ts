import { describe, expect, it } from 'vitest';
import type { NpzResult } from '@calab/core';
import { pickArray } from '../lib/parse.ts';

const arr = (shape: number[]) => ({
  data: new Float64Array(shape.reduce((a, b) => a * b, 1)),
  shape,
  dtype: '<f8',
  fortranOrder: false,
});
const file = (arrays: Record<string, number[]>): NpzResult => ({
  arrays: Object.fromEntries(Object.entries(arrays).map(([k, s]) => [k, arr(s)])),
  arrayNames: Object.keys(arrays),
});

describe('choosing the array in a .npz or .mat file', () => {
  it('takes the only matrix, ignoring scalars and vectors', () => {
    expect(pickArray(file({ C: [180, 9000], fs: [1, 1], t: [1, 9000] }), 2)).toBe('C');
    expect(pickArray(file({ A: [180, 160, 160], C: [180, 9000] }), 3)).toBe('A');
  });
  it('names the arrays when several fit, and what the file holds when none does', () => {
    expect(() => pickArray(file({ C: [180, 9000], S: [180, 9000] }), 2)).toThrow(
      'several arrays that could be the data: C, S',
    );
    expect(() => pickArray(file({ fs: [1, 1] }), 3)).toThrow('It holds: fs (1 x 1)');
  });
});
