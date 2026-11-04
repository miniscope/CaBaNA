import { describe, expect, it } from 'vitest';
import {
  classText,
  decoderName,
  reviewGroups,
  runCards,
  sectionSummary,
  type DecodeView,
} from '../panels/decoding/review.ts';

const view = (o: Partial<DecodeView> = {}): DecodeView => ({
  target: 'position',
  decoder: 'bayesian',
  likelihood: 'gaussian',
  sigma: 'per_state',
  windowS: 0.25,
  smoothSigmaBins: 0,
  prior: 'occupancy',
  mode: 'one_vs_rest',
  C: 1,
  binS: 0.5,
  folds: 5,
  foldGapS: 1,
  shuffles: 1000,
  blockS: 1,
  correction: 'max_stat',
  alpha: 0.05,
  seed: 0,
  minFramesPerClass: 20,
  overlap: 'exclude',
  other: false,
  selected: [],
  ...o,
});

describe('setup labels', () => {
  it('names the decoder and the classes', () => {
    expect(decoderName(view())).toBe('Bayesian (Gaussian, per bin)');
    expect(decoderName(view({ likelihood: 'poisson' }))).toBe('Bayesian (Poisson)');
    expect(decoderName(view({ decoder: 'logistic', mode: 'multiclass' }))).toBe(
      'Logistic regression (multiclass)',
    );
    expect(classText(view({ selected: ['social'], other: true }))).toBe(
      'social vs Other (all other included frames)',
    );
    expect(classText(view({ selected: ['a', 'b'] }))).toBe('2 classes: a, b');
  });
  it('summarizes sections, saying no temporal gap for 0 s', () => {
    expect(sectionSummary('folds', view())).toBe('5 train/test splits · 1 s separation');
    expect(sectionSummary('folds', view({ foldGapS: 0 }))).toMatch(/no temporal gap/);
    expect(sectionSummary('significance', view({ correction: 'none' }))).toMatch(/uncorrected/);
  });
  it('lists every setting in Review, with behavior-only items for behaviors', () => {
    const groups = reviewGroups(view(), { speedCmS: 2, cells: 40, frames: 9000 });
    expect(groups.map((g) => g.title)).toEqual([
      'Target and data',
      'Decoder',
      'Train and test',
      'Significance',
      'Data',
    ]);
    const labels = (v: DecodeView) =>
      reviewGroups(v, {}).flatMap((g) => g.items.map((i) => i.label));
    expect(labels(view())).toContain('Map smoothing');
    expect(labels(view())).not.toContain('Overlapping behaviors');
    const b = view({ target: 'behaviors', decoder: 'logistic', selected: ['a', 'b'] });
    expect(labels(b)).toEqual(
      expect.arrayContaining(['Classes', 'C', 'Time bin', 'Overlapping behaviors']),
    );
  });
  it('run cards separate analysis scope, separation and currency', () => {
    const cards = runCards({
      engine: 'browser',
      preliminary: false,
      shuffles: 1000,
      foldGapS: 0,
      outdated: true,
    });
    expect(cards.map((c) => c.value)).toEqual(['Browser', 'Full', 'None', 'Changed']);
    expect(cards[2].denom).toBe('no temporal gap');
  });
});
