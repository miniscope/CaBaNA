// The Checks row of Data visualization: counts in words, worst first, tone with each part.

import { describe, expect, it } from 'vitest';
import {
  behaviorParts,
  cellsParts,
  inputsParts,
  navTicks,
  neuralParts,
  partsText,
  positionParts,
} from '../lib/viz-checks.ts';

const st = (...s: ('pass' | 'warn' | 'fail')[]) => s.map((status) => ({ status }));

describe('viz checks row', () => {
  it('counts input checks as passed and warnings', () => {
    expect(partsText(inputsParts(st('pass', 'pass', 'warn')))).toBe('2 passed · 1 warning');
    expect(inputsParts(st('fail'))).toEqual([{ text: '1 failed', tone: 'fail' }]);
    expect(inputsParts([])[0].tone).toBe('muted');
  });

  it('lists flagged cells, overlapping pairs and rejected cells', () => {
    expect(partsText(cellsParts({ flagged: 7, pairs: 1, rejected: 2, failed: 0 }))).toBe(
      '7 flagged · 1 overlapping pair · 2 rejected',
    );
    expect(cellsParts({ flagged: 0, pairs: 0, rejected: 0, failed: 0 })).toEqual([
      { text: 'none flagged', tone: 'ok' },
    ]);
    expect(partsText(cellsParts(undefined))).toBe('not loaded');
  });

  it('puts failed checks before flagged ones', () => {
    expect(neuralParts(st('warn', 'fail', 'pass')).map((p) => p.tone)).toEqual([
      'fail',
      'flag',
      'ok',
    ]);
    expect(partsText(neuralParts([]))).toBe('no checks ran');
  });

  it('names position jumps and gaps, and flagged epochs', () => {
    expect(partsText(positionParts({ failed: 1, jumps: 7, gaps: 2 }))).toBe(
      '1 failed · 7 jumps · 2 gaps',
    );
    expect(partsText(positionParts({ failed: 0, jumps: 1, gaps: 0 }))).toBe('1 jump');
    expect(partsText(behaviorParts({ failed: 0, epochs: 1 }))).toBe('1 epoch flagged');
    expect(partsText(behaviorParts({ failed: 2, epochs: 3 }))).toBe('2 failed · 3 epochs flagged');
    expect(partsText(behaviorParts({ failed: 0, epochs: 0, unpaired: 2 }))).toBe('2 unpaired rows');
  });
});

describe('navigator ticks', () => {
  it('places flagged and corrected times as percent of the session, merging close ones', () => {
    expect(navTicks([50, 10, 10.1, 200, NaN], [25], [0, 100])).toEqual([
      { left: 10, kind: 'flag' },
      { left: 50, kind: 'flag' },
      { left: 25, kind: 'correction' },
    ]);
  });
});
