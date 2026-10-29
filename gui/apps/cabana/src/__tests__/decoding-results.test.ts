import { describe, expect, it } from 'vitest';
import { loadBehaviorDecoding, loadPositionDecoding } from '../lib/decoding-results.ts';
import { openFixture } from './fixture-source.ts';

const open = openFixture;

describe('position decoding view', () => {
  const [d, src] = open('bayes_position_open_field');
  it('reads the overall error, chance, per-bin values and p-values from the arrays', async () => {
    const v = (await loadPositionDecoding(src, d.manifest))!;
    const arr = d.arrays.decoding_position;
    expect(v.overall.value).toBe(arr.extra_3.data[0]);
    expect(v.overall.chance).toBe(arr.extra_5.data[0]);
    expect(v.bins).toHaveLength(169);
    expect(v.medianErrorPerBin).toEqual(Array.from(arr.values.data));
    expect(v.p).toEqual(Array.from(arr.sh_p_value.data));
    expect(v.frameError?.shape).toEqual([18000]);
  });
  it('says the overall value is not tested without F2, and has no p', async () => {
    const v = (await loadPositionDecoding(src, d.manifest, false))!;
    expect(v.overall.p).toBeNull();
    expect(v.overall.testNote).toMatch(/not tested.*F2/);
    expect((await loadPositionDecoding(src, d.manifest, true))!.overall.testNote).toBe('');
  });
  it('marks bins without a value as excluded and states the rule', async () => {
    const v = (await loadPositionDecoding(src, d.manifest))!;
    expect(v.excluded.filter(Boolean).length).toBe(v.medianErrorPerBin.filter((x) => x == null).length);
    expect(v.exclusionRule).toMatch(/min_frames_per_class/);
    expect(v.label).toMatch(/label shuffle.*max stat correction across eligible spatial bins/s);
  });
});

describe('behavior decoding view', () => {
  const [d, src] = open('decode_logistic_social');
  it('reads accuracy, per-behavior scores and one-vs-rest tables', async () => {
    const v = (await loadBehaviorDecoding(src, d.manifest))!;
    const arr = d.arrays.decoding_behavior;
    expect(v.overall.value).toBe(arr.extra_1.data[0]);
    expect(v.score).toEqual(Array.from(arr.values.data));
    expect(v.confusionKind).toBe('one_vs_rest');
    expect(v.rowShares()).toBeUndefined();
  });
  it('returns nothing when the run holds no decoding result', async () => {
    const [d2, src2] = open('pca_population');
    expect(await loadBehaviorDecoding(src2, d2.manifest)).toBeUndefined();
  });
});
