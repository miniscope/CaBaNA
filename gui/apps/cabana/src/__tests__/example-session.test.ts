import { describe, expect, it } from 'vitest';
import { countProcessing, workText } from '../lib/example-session.ts';
import { saveText } from '../lib/save-status.ts';
import type { ProcessingState } from '../lib/project-files.ts';

const base: ProcessingState = {
  rejectedCells: [],
  excludeFrames: [],
  keptFrames: [],
  annotationFixes: { merge: false, drop: false },
  reviewed: [],
  continued: [],
  limits: { tol: {}, maxSpeed: 100 },
  prep: {
    eventSigmaS: 0,
    traceSigmaS: 0,
    maxGapS: 1,
    fillGapS: 1,
    posMethod: 'median',
    posWindowS: 1,
    speedWindowS: 1,
    minSpeed: 0,
    labelPadS: 0,
  },
  decon: { indicator: 'GCaMP6f', tauRise: 0.1, tauDecay: 0.5 },
};

describe('countProcessing', () => {
  it('is zero for an untouched session', () => {
    expect(countProcessing(base, structuredClone(base))).toEqual({ corrections: 0, prep: 0 });
  });
  it('counts rejected cells and changed settings', () => {
    const now = structuredClone(base);
    now.rejectedCells = [3, 7];
    now.prep.eventSigmaS = 0.2;
    expect(countProcessing(base, now)).toEqual({ corrections: 2, prep: 1 });
  });
  it('counts a restored cell as a change too', () => {
    const before = { ...structuredClone(base), rejectedCells: [3] };
    expect(countProcessing(before, base).corrections).toBe(1);
  });
});

describe('workText', () => {
  const zero = { corrections: 0, prep: 0, analysis: 0, runs: 0, log: 0 };
  it('lists the nonzero parts', () => {
    expect(workText({ ...zero, corrections: 1, prep: 1, runs: 2 })).toBe(
      '1 QC correction, 1 preprocessing change and 2 analysis runs',
    );
    expect(workText({ ...zero, runs: 1 })).toBe('1 analysis run');
    expect(workText(zero)).toBe('');
  });
});

describe('example status', () => {
  it('reads as unsaved example data', () => {
    expect(saveText({ kind: 'example' }).text).toBe('Example data · Unsaved');
  });
});
