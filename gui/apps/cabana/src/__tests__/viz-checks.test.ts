// The session navigator's marks.

import { describe, expect, it } from 'vitest';
import { navTicks } from '../lib/viz-checks.ts';

describe('navigator ticks', () => {
  it('places flagged and corrected times as percent of the session, merging close ones', () => {
    expect(navTicks([50, 10, 10.1, 200, NaN], [25], [0, 100])).toEqual([
      { left: 10, kind: 'flag' },
      { left: 50, kind: 'flag' },
      { left: 25, kind: 'correction' },
    ]);
  });
});
