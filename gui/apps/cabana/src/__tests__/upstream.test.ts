// The Upstream list: findings only a new export, re-tracking or re-extraction can fix, each with
// where to fix it; clean data lists nothing.

import { describe, expect, it } from 'vitest';
import { upstreamItems } from '../lib/upstream.ts';

describe('upstreamItems', () => {
  it('lists nothing for clean data', () => {
    expect(
      upstreamItems({
        timing: [{ name: 'Miniscope', nDropped: 0, droppedFraction: 0, gaps: 0 }],
        alignment: [{ title: 'Timestamps match the neural data', status: 'pass' }],
        longGaps: { n: 0, frames: 0, fillLimitS: 0.5, fps: 30 },
        overlap: { status: 'pass', pairs: 2 },
      }),
    ).toEqual([]);
  });

  it('lists dropped frames, failed alignment, long position gaps and many overlaps', () => {
    const items = upstreamItems({
      timing: [{ name: 'Behavior camera', nDropped: 12, droppedFraction: 0.004, gaps: 3 }],
      alignment: [
        { title: 'Timestamps match the neural data', status: 'fail', value: '9000 vs 8990' },
      ],
      longGaps: { n: 2, frames: 45, fillLimitS: 0.5, fps: 30 },
      overlap: { status: 'warn', pairs: 9 },
    });
    expect(items.map((i) => [i.source, i.what, i.fixWhere])).toEqual([
      [
        'Timestamps',
        'Behavior camera: 12 dropped frames',
        'Check the camera recording and re-export the timestamps',
      ],
      [
        'Timestamps',
        'Timestamps match the neural data',
        'Re-export the timestamps and neural data from the same recording',
      ],
      [
        'Position',
        '2 position gaps longer than 0.5 s',
        'Re-run tracking where position is missing',
      ],
      [
        'Footprints',
        '9 overlapping footprint pairs',
        'Re-run cell extraction (merge duplicates) and re-export',
      ],
    ]);
    expect(items[0].detail).toBe('0.40% of frames, in 3 gaps. The frames were never recorded.');
    expect(items[2].detail).toBe(
      '45 neural frames (1.5 s) stay without a position after gap filling.',
    );
  });
});
