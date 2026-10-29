import { describe, expect, it } from 'vitest';
import {
  labelCounts,
  missingStimulusLabels,
  populationStateCount,
} from '../lib/readiness-snapshot.ts';
import type { LabelEntry } from '../lib/labels.ts';

const entry = (over: Partial<LabelEntry>): LabelEntry => ({
  name: 'x',
  source: 'epochs',
  file: 'f.csv',
  slot: 'behavior_annotations',
  count: 3,
  problems: [],
  blocked: false,
  ...over,
});
const registry = [
  entry({ name: 'sniff' }),
  entry({ name: 'groom' }),
  entry({ name: 'dup', blocked: true }),
  entry({ name: 'center', slot: 'zone_annotations' }),
  entry({ name: 'tone', source: 'markers', slot: 'time_markers' }),
];

describe('snapshot helpers', () => {
  it('counts only usable labels, by what analyses can do with them', () => {
    expect(labelCounts(registry)).toEqual({ epochs: 3, zones: 1, behaviors: 2, alignable: 4 });
  });
  it('reports each missing stimulus label once and ignores unlabeled stimuli', () => {
    expect(missingStimulusLabels([{ label: 'tone' }, { label: 'tone' }, { label: '' }])).toEqual([
      'tone',
    ]);
  });
  it('counts population states for the chosen target', () => {
    expect(populationStateCount('behaviors', [], registry, true)).toBe(2);
    expect(populationStateCount('behaviors', ['sniff', 'missing'], registry, true)).toBe(1);
    expect(populationStateCount('zones', [], registry, true)).toBe(1);
    expect(populationStateCount('position', [], registry, true)).toBe(2);
    expect(populationStateCount('position', [], registry, false)).toBe(0);
  });
});
