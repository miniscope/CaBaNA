import { describe, expect, it } from 'vitest';
import { alignmentChecks, clockProgress } from '../lib/qc.ts';

const range = (n: number, dt: number, t0 = 0) => Array.from({ length: n }, (_, i) => t0 + i * dt);

describe('alignmentChecks', () => {
  it('fails when a neural file has a different frame count from the timestamps', () => {
    const [frames] = alignmentChecks(
      range(100, 0.1),
      [
        ['Events', 100],
        ['Traces', 99],
      ],
      undefined,
      0,
    );
    expect(frames.status).toBe('fail');
    expect(frames.value).toBe('1 of 2 files differ');
  });

  it('passes when the camera covers the miniscope recording', () => {
    const [, span] = alignmentChecks(range(100, 0.1), [['Events', 100]], range(60, 0.2, -1), 0);
    expect(span.status).toBe('pass');
    expect(span.value).toBe('0 frames outside');
  });

  it('warns when the camera starts late', () => {
    const [span] = alignmentChecks(range(100, 0.1), [], range(50, 0.2, 2), 0);
    expect(span.id).toBe('align-span');
    expect(span.status).toBe('warn');
    expect(span.value).toBe('20 frames outside');
  });
});

describe('clockProgress', () => {
  it('merges both clocks in time order, each running 0 to 100%', () => {
    const [t, a, b] = clockProgress([0, 1, 2], [0.5, 1.5]);
    expect(t).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(a).toEqual([0, undefined, 50, undefined, 100]);
    expect(b).toEqual([undefined, 0, undefined, 100, undefined]);
  });
});
