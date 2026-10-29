import { describe, expect, it } from 'vitest';
import { positionIssue } from '../lib/prepared.ts';
import { addFiles } from '../lib/store.ts';

describe('why position is unavailable', () => {
  it('names the first thing missing', async () => {
    expect(positionIssue()).toBe('Position needs a position file.');
    await addFiles([new File(['frame,x,y\n0,1,1\n1,2,2\n'], 'position.csv')]);
    expect(positionIssue()).toBe('Position needs camera timestamps.');
    await addFiles([new File(['frame number,time stamp\n0,0\n1,33\n'], 'behavior_timestamps.csv')]);
    expect(positionIssue()).toBeUndefined();
    expect(positionIssue(true)).toBe('Position needs neural timestamps.');
  });
});
