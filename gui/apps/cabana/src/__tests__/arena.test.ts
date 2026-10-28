import { describe, expect, it } from 'vitest';
import { arena, effectiveBin, positionsCm, setArena, setBinCm } from '../lib/arena.ts';
import { addFiles, setSource } from '../lib/store.ts';

describe('bin size', () => {
  it('is at least 0.5 cm and at most half the smaller arena side', () => {
    setArena({ width: 40, height: 30 });
    setBinCm(100);
    expect(effectiveBin()).toBe(15);
    setBinCm(0.1);
    expect(arena.binCm).toBe(0.5);
    setBinCm(4);
    expect(effectiveBin()).toBe(4);
  });
});

describe('position in cm', () => {
  it('flips y with the arena height when y increases down', async () => {
    setArena({ width: 60, height: 38 });
    await addFiles([
      new File(['frame,x,y\n0,5,3\n1,6,30\n'], 'position.csv'),
      new File(['frame number,time stamp\n0,0\n1,33\n'], 'behavior_timestamps.csv'),
    ]);
    expect(positionsCm().y).toEqual([3, 30]);
    setSource('yDown', true);
    expect(positionsCm().y).toEqual([35, 8]);
    expect(positionsCm().x).toEqual([5, 6]);
  });
});
