import { describe, expect, it } from 'vitest';
import {
  appliesGap,
  classMode,
  engineLines,
  gapBlock,
  gapRecord,
  GAP_UNAVAILABLE,
  withClassMode,
  type Request,
} from '../panels/decoding/engines.ts';
import { localChecks, type InputFacts } from '../panels/decoding/logic.ts';
import { behaviorDecodingPipeline, positionDecodingPipeline } from '../lib/spec/decoding.ts';
import { DEFAULT_BEHAVIOR_DECODING, DEFAULT_POSITION_DECODING } from '../lib/decoding-settings.ts';
import { populationContext } from '../lib/analysis-registry.ts';

const none = () => false;
const all = () => true;
const req = (o: Partial<Request> = {}): Request => ({
  target: 'position',
  decoder: 'bayesian',
  mode: 'one_vs_rest',
  overlap: 'exclude',
  foldGapS: 1,
  ...o,
});
const line = (ls: ReturnType<typeof engineLines>, label: string) =>
  ls.find((l) => l.label === label)!;

describe('training/test separation by engine', () => {
  it('the browser engine never applies it; the framework only when it reports the feature', () => {
    expect(appliesGap('browser', all)).toBe(false);
    expect(appliesGap('framework', none)).toBe(false);
    expect(appliesGap('framework', all)).toBe(true);
  });
  it('a separation the engine cannot apply is not offered as a full run until set to 0', () => {
    expect(gapBlock('browser', 1, all)).toMatch(/Set it to 0 s.*no temporal gap/);
    expect(gapBlock('framework', 0.5, none)).toMatch(/Python framework cannot apply the 0.5 s/);
    expect(gapBlock('browser', 0, none)).toBe('');
    expect(gapBlock('framework', 1, all)).toBe('');
  });
  it('the Review line states the consequence of a missing separation', () => {
    const l = line(engineLines('browser', req(), all), 'Training/test separation');
    expect(l.status).toBe('unavailable');
    expect(l.text).toBe(GAP_UNAVAILABLE);
    expect(l.text).toMatch(/inflated by temporal dependence/);
    expect(line(engineLines('framework', req(), all), 'Training/test separation').status).toBe(
      'applied',
    );
    const zero = line(
      engineLines('framework', req({ foldGapS: 0 }), none),
      'Training/test separation',
    );
    expect(zero.status).toBe('none');
    expect(zero.text).toMatch(/no temporal gap/);
  });
  it('records the separation of a saved run in words', () => {
    expect(gapRecord(1)).toBe('1 s');
    expect(gapRecord(0)).toMatch(/no temporal gap/);
    expect(gapRecord(undefined)).toMatch(/Not recorded/);
  });
});

describe('what each engine lists', () => {
  it('reads the other framework features from capabilities', () => {
    const fw = engineLines('framework', req({ target: 'behaviors' }), none);
    expect(line(fw, 'Overall value tested').status).toBe('unavailable');
    expect(line(fw, 'Test window at block edges').status).toBe('unavailable');
    expect(line(fw, 'Overlapping behaviors excluded').status).toBe('unavailable');
    const full = engineLines('framework', req({ target: 'behaviors' }), all);
    expect(full.every((l) => l.status !== 'unavailable')).toBe(true);
  });
  it('browser engine: preview and multiclass unavailable, random draws noted', () => {
    const b = engineLines(
      'browser',
      req({ decoder: 'logistic', mode: 'multiclass', target: 'behaviors' }),
      none,
    );
    expect(line(b, 'Quick preview').status).toBe('unavailable');
    expect(line(b, 'Multiclass logistic regression').status).toBe('unavailable');
    expect(line(b, 'Random draws')).toBeTruthy();
    expect(b.find((l) => l.label === 'Test window at block edges')).toBeUndefined();
  });
});

describe('framework requirements follow the separation', () => {
  const ctx = () => ({ ...populationContext(), has: none });
  it('a separation of 0 s needs no framework feature', () => {
    const zero = { ...DEFAULT_POSITION_DECODING, foldGapS: 0 };
    expect(positionDecodingPipeline(zero, ctx()).requires).toEqual([]);
    expect(positionDecodingPipeline(DEFAULT_POSITION_DECODING, ctx()).requires).toEqual([
      'decoding_fold_gap',
    ]);
  });
});

describe('one behavior against Other', () => {
  it('is the mode when exactly one behavior and Other are chosen', () => {
    expect(classMode(['a'], true)).toBe('one_vs_other');
    expect(classMode(['a', 'b'], true)).toBe('several');
    expect(classMode(['a'], false)).toBe('several');
  });
  it('switching sets the behavior and Other, and back clears them', () => {
    expect(withClassMode('one_vs_other', ['b', 'c'], ['a', 'b', 'c'])).toEqual({
      labels: ['b'],
      other: true,
    });
    expect(withClassMode('one_vs_other', [], ['a', 'b'])).toEqual({ labels: ['a'], other: true });
    expect(withClassMode('several', ['b'], ['a', 'b'])).toEqual({ labels: [], other: false });
  });
  const facts = (o: Partial<InputFacts>): InputFacts => ({
    neuralLoaded: true,
    deconvolved: true,
    positionLoaded: true,
    arenaOutline: true,
    usableBehaviors: ['a', 'b'],
    selected: ['a'],
    minFramesPerClass: 20,
    ...o,
  });
  it('one behavior is enough with Other, not without', () => {
    expect(localChecks('behaviors', facts({}))[0]).toMatch(/Select at least 2/);
    expect(localChecks('behaviors', facts({ other: true }))).toEqual([]);
    expect(localChecks('behaviors', facts({ usableBehaviors: ['a'], other: true }))).toEqual([]);
    expect(localChecks('behaviors', facts({ usableBehaviors: ['a'] }))[0]).toMatch(
      /at least 2 usable/,
    );
  });
  it('the pipeline accepts one behavior with Other', () => {
    const s = { ...DEFAULT_BEHAVIOR_DECODING, labels: ['a'], other: true };
    const ctx = { ...populationContext(), has: all };
    expect(behaviorDecodingPipeline(s, ctx).problems).toEqual([]);
    expect(behaviorDecodingPipeline({ ...s, other: false }, ctx).problems[0]).toMatch(
      /at least 2 behaviors/,
    );
  });
});
