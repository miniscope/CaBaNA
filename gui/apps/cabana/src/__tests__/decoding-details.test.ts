import { describe, expect, it } from 'vitest';
import { analysisDetails } from '../panels/decoding/review.ts';

describe('analysis details of a saved run', () => {
  const saved = {
    type: 'position',
    folds: 5,
    foldGapS: 0,
    shuffles: 1000,
    correction: 'max_stat',
    alpha: 0.05,
    likelihood: 'gaussian',
    sigma: 'per_state',
  };
  it('records no temporal gap for a separation of 0 s', () => {
    const rows = Object.fromEntries(analysisDetails(saved, 'browser'));
    expect(rows['Training/test separation']).toMatch(/no temporal gap/);
    expect(rows.Decoder).toBe('Bayesian (Gaussian, per bin)');
    expect(rows.Significance).toBe('1,000 shuffles · max-stat across eligible bins · alpha 0.05');
    expect(rows.Engine).toBe('Browser engine');
  });
  it('says not recorded where the run does not hold a value', () => {
    const rows = Object.fromEntries(
      analysisDetails({ type: 'behaviors', decoder: 'logistic' }, undefined),
    );
    expect(rows['Training/test separation']).toMatch(/Not recorded/);
    expect(rows['Cross-validation']).toBe('Not recorded');
    expect(rows.Significance).toBe('Not recorded');
    expect(rows.Engine).toBeUndefined();
  });
});
