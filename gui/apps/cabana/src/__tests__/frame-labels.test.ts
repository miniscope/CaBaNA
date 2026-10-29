import { describe, expect, it } from 'vitest';
import {
  agreement,
  frameLabelCounts,
  joinByFrame,
  readFrameLabels,
  readFrameTable,
  suggestRoles,
  type FrameLabelMapping,
} from '../lib/frame-labels.ts';

const csv = [
  'frame,x,grooming,behavior,note',
  '0,1.5,1,grooming,',
  '1,2.5,0,rearing,',
  '2,3.5,,,',
  '4,4.5,1,rearing,',
].join('\n');
const mapping: FrameLabelMapping = {
  frameColumn: 'frame',
  binary: ['grooming'],
  categorical: ['behavior'],
  signals: ['x'],
};

describe('suggestRoles', () => {
  it('guesses roles from the values', () => {
    expect(suggestRoles(readFrameTable(csv))).toEqual({
      frame: 'frame',
      x: 'signal',
      grooming: 'binary',
      behavior: 'categorical',
      note: 'ignore',
    });
  });
  it('uses the given frame column', () => {
    const t = readFrameTable('n,frame\n0,1\n1,0\n');
    expect(suggestRoles(t, 'n')).toEqual({ n: 'frame', frame: 'binary' });
  });
});

describe('readFrameLabels', () => {
  it('reads values with blanks as missing', () => {
    const r = readFrameLabels(csv, mapping);
    expect(r.errors).toEqual([]);
    expect(r.frames).toEqual([0, 1, 2, 4]);
    expect(r.binary.grooming).toEqual([1, 0, null, 1]);
    expect(r.categorical.behavior).toEqual(['grooming', 'rearing', null, 'rearing']);
    expect(r.signals.x).toEqual([1.5, 2.5, 3.5, 4.5]);
  });
  it('errors on duplicate frame numbers', () => {
    const r = readFrameLabels('frame,a\n0,1\n0,0\n', {
      ...mapping,
      binary: ['a'],
      categorical: [],
      signals: [],
    });
    expect(r.errors.join(' ')).toContain('Duplicate frame numbers: 0');
  });
  it('errors on binary values other than 0/1', () => {
    const r = readFrameLabels('frame,a\n0,2\n', {
      ...mapping,
      binary: ['a'],
      categorical: [],
      signals: [],
    });
    expect(r.errors.join(' ')).toContain('"a"');
  });
  it('errors on a missing column', () => {
    expect(readFrameLabels(csv, { ...mapping, binary: ['nope'] }).errors[0]).toContain('nope');
  });
});

describe('joinByFrame', () => {
  it('matches by frame number and leaves missing frames unscored', () => {
    const j = joinByFrame(readFrameLabels(csv, mapping), [0, 1, 2, 3, 4, 5]);
    expect(j.binary.grooming).toEqual([1, 0, null, null, 1, null]);
    expect(j.categorical.behavior[3]).toBeNull();
    expect(j.signals.x[3]).toBeNaN();
    expect(j.unscored).toBe(2);
    expect(j.notInCamera).toBe(0);
  });
  it('counts file rows that are not camera frames', () => {
    expect(joinByFrame(readFrameLabels(csv, mapping), [0, 1]).notInCamera).toBe(2);
  });
});

describe('agreement', () => {
  const frames = [10, 11, 12, 13, 14, 15, 16, 17, 18];
  it('reports conflicts, first frames and one-source-only frames', () => {
    const binary = { grooming: [1, 1, 0, 0, null, 1, 0, 1, 1] as (0 | 1 | null)[] };
    const categorical = {
      behavior: [
        'grooming',
        'rearing',
        'grooming',
        'rearing',
        'grooming',
        null,
        null,
        'grooming',
        'rearing',
      ],
    };
    const [a] = agreement(frames, binary, categorical);
    // conflicts at frames 11 (1 vs rearing), 12 (0 vs grooming), 18 (1 vs rearing)
    expect(a).toEqual({
      label: 'grooming',
      conflicts: 3,
      firstFrames: [11, 12, 18],
      oneSourceOnly: 3,
    });
  });
  it('caps the listed frames at five', () => {
    const n = 20;
    const f = Array.from({ length: n }, (_, i) => i);
    const [b] = agreement(f, { x: Array(n).fill(0) }, { c: Array(n).fill('x') });
    expect(b.conflicts).toBe(n);
    expect(b.firstFrames).toEqual([0, 1, 2, 3, 4]);
  });
  it('skips binary columns whose name is not a category value', () => {
    expect(agreement([0], { rearing: [1] }, { behavior: ['grooming'] })).toEqual([]);
  });
});

describe('frameLabelCounts', () => {
  it('counts ones and category values', () => {
    const c = frameLabelCounts(readFrameLabels(csv, mapping));
    expect(c.binary).toEqual([{ name: 'grooming', count: 2 }]);
    expect(c.categorical).toEqual([
      { name: 'grooming', count: 1 },
      { name: 'rearing', count: 2 },
    ]);
  });
});
