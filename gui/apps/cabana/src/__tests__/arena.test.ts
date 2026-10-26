import { describe, expect, it } from 'vitest';
import { arena, effectiveBin, setArena, setBinCm } from '../lib/arena.ts';

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
