import { describe, expect, it } from 'vitest';
import { labelFlags } from '../lib/label-flags.ts';

describe('label file flags', () => {
  it('flags conflicting frames and markers outside the recording', () => {
    const f = labelFlags({
      conflicts: [
        { label: 'grooming', conflicts: 5 },
        { label: 'rearing', conflicts: 0 },
      ],
      markersOutside: 1,
      markers: 9,
    });
    expect(f.map((x) => x.action)).toEqual(['conflicts', 'markers']);
    expect(f[0].title).toBe('5 frame label conflicts');
    expect(f[0].detail).toContain('grooming');
    expect(f[0].detail).not.toContain('rearing');
    expect(f[1].title).toBe('1 time marker outside the recording');
  });

  it('has no flags when everything agrees', () => {
    expect(labelFlags({ conflicts: [], markersOutside: 0, markers: 4 })).toEqual([]);
  });
});
