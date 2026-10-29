import { describe, expect, it } from 'vitest';
import { DEFAULT_PREP } from '../lib/preprocess.ts';
import {
  DEFAULT_BEHAVIOR_DECODING,
  DEFAULT_POSITION_DECODING,
} from '../lib/decoding-settings.ts';
import { DEFAULT_POPULATION } from '../lib/population-settings.ts';
import { behaviorDecodingPipeline, positionDecodingPipeline } from '../lib/spec/decoding.ts';
import { commonSteps, type CommonInput } from '../lib/spec/pipeline.ts';
import { populationPipeline, type PopulationContext } from '../lib/spec/population.ts';
import { DEFAULT_AUROC_SETTINGS } from '../lib/auroc-run.ts';
import { DEFAULT_PLACE_SETTINGS } from '../lib/place-run.ts';
import { aurocPipeline, placePipeline } from '../lib/spec/place.ts';
import { canonicalJson, settingsDiff } from '../lib/settings-hash.ts';

const common: CommonInput = {
  positionUnit: 'cm',
  pxPerCm: 1,
  fillGapS: DEFAULT_PREP.fillGapS,
  posWindowS: DEFAULT_PREP.posWindowS,
  posMethod: DEFAULT_PREP.posMethod,
  speedWindowS: DEFAULT_PREP.speedWindowS,
  minSpeed: DEFAULT_PREP.minSpeed,
  eventSigmaS: 0.1,
  labelPadS: 0,
  paddedLabels: [],
  hasArenaBox: true,
  binCm: 3,
  arenaCm: [40, 40] as [number, number],
  rejected: [2, 5],
};
const ctx = (labels: string[], has = false): PopulationContext & { has: () => boolean } => ({
  common,
  behaviorSource: 'social_epochs',
  zoneSource: 'zones_epochs',
  labels: { behaviors: labels, zones: ['a', 'b'] },
  has: () => has,
});
const social = ['follow', 'sniff_anogenital', 'sniff_face'];
const snap = (name: string, spec: unknown) =>
  expect(JSON.stringify(spec, null, 1) + '\n').toMatchFileSnapshot(`./fixtures/specs/${name}.json`);

describe('common steps', () => {
  it('omits select_cells for the bridge and keeps it for the YAML', () => {
    expect(commonSteps(common, { rejected: 'omit' }).preprocess.some((s) => s.name === 'select_cells')).toBe(false);
    expect(commonSteps(common).preprocess[0]).toEqual({ name: 'select_cells', exclude_ids: ['2', '5'] });
  });
  it('leaves out position steps when the analysis never reads position', () => {
    const { transforms, preprocess } = commonSteps(common, { position: false, rejected: 'omit' });
    expect(transforms).toEqual([]);
    expect(preprocess).toEqual([{ name: 'smooth_activity', sigma_s: 0.1 }]);
  });
});

describe('population spec', () => {
  it('builds the five-method pipeline with the shared time bin', async () => {
    const built = populationPipeline(
      { ...DEFAULT_POPULATION, methods: { ...DEFAULT_POPULATION.methods, pairwise: true } },
      ctx(social),
    );
    expect(built.problems).toEqual([]);
    const names = (built.pipeline.analyses as { name: string }[]).map((a) => a.name);
    expect(names).toEqual(['pv_similarity', 'pv_stability', 'state_separation', 'dimensionality', 'pairwise']);
    await snap('population-behaviors', built);
  });
  it('blocks noise correlation on overlapping behaviors and single-label targets', () => {
    const noise = { ...DEFAULT_POPULATION, methods: { ...DEFAULT_POPULATION.methods, pairwise: true }, pairwiseKind: 'noise' as const };
    expect(populationPipeline(noise, ctx(social)).problems.join(' ')).toMatch(/Noise correlation needs exclusive/);
    expect(populationPipeline(DEFAULT_POPULATION, ctx(['only'])).problems.join(' ')).toMatch(/at least 2 labels/);
  });
  it('uses position bins with the speed mask', async () => {
    const built = populationPipeline({ ...DEFAULT_POPULATION, target: 'position' }, ctx(social));
    await snap('population-position', built);
    expect((built.pipeline.analyses as { masks: string[] }[])[0].masks).toEqual(['speed']);
  });
  it('quick preview uses 50 shuffles', () => {
    const built = populationPipeline(DEFAULT_POPULATION, ctx(social), true);
    expect((built.pipeline.analyses as { shuffle: { n_shuffles: number } }[])[0].shuffle.n_shuffles).toBe(50);
  });
});

describe('decoding spec', () => {
  it('position: Bayesian on the grid, no event smoothing, gated on F1', async () => {
    const built = positionDecodingPipeline(DEFAULT_POSITION_DECODING, ctx(social));
    expect(built.requires).toContain('decoding_fold_gap');
    expect(JSON.stringify(built.pipeline)).not.toContain('smooth_activity');
    await snap('decoding-position', built);
  });
  it('behaviors: exclusive states, overlap policy, Bayesian and logistic', async () => {
    await snap('decoding-behavior-bayes', behaviorDecodingPipeline(DEFAULT_BEHAVIOR_DECODING, ctx(social)));
    const logistic = behaviorDecodingPipeline({ ...DEFAULT_BEHAVIOR_DECODING, decoder: 'logistic' }, ctx(social));
    expect((logistic.pipeline.preprocess as { name: string }[]).at(-1)?.name).toBe('rebin_time');
    await snap('decoding-behavior-logistic', logistic);
  });
  it('adds fold gap and overlap policy when the framework has them', () => {
    const built = behaviorDecodingPipeline(DEFAULT_BEHAVIOR_DECODING, ctx(social, true));
    const text = JSON.stringify(built.pipeline);
    expect(text).toContain('"fold_gap_s":1');
    expect(text).toContain('"overlap":"exclude"');
  });
  it('leaves out fields of missing framework features', () => {
    const built = behaviorDecodingPipeline(DEFAULT_BEHAVIOR_DECODING, ctx(social));
    expect(JSON.stringify(built.pipeline)).not.toMatch(/fold_gap_s|overlap"/);
    expect(built.requires).toEqual(['decoding_fold_gap', 'overlap_policy']);
  });
});

describe('settings hash helpers', () => {
  it('canonical json ignores key order and undefined', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe('{"a":[2,{"d":1}],"b":1}');
  });
  it('diff names each changed field', () => {
    expect(settingsDiff({ a: { n: 50 }, k: 1 }, { a: { n: 200 }, k: 1, z: 2 })).toEqual(['a.n: 50 -> 200', 'z: unset -> 2']);
  });
});

describe('place cell and auROC specs (framework engine, not yet used by the pages)', () => {
  it('place cells: three analyses on the speed-gated grid, both selectors automatic', async () => {
    const built = placePipeline(DEFAULT_PLACE_SETTINGS, common, 3);
    expect(built.problems).toEqual([]);
    expect((built.pipeline.selectors as { name: string }[]).map((x) => x.name)).toEqual(['auto_smooth_sigma', 'auto_null_timescale']);
    await snap('place-cells', built);
  });
  it('auROC: rest comparison, circular null, max-stat across behaviors', async () => {
    const built = aurocPipeline(DEFAULT_AUROC_SETTINGS, common, 'social_epochs', social);
    expect(built.problems).toEqual([]);
    await snap('auroc-circular', built);
    const matched = aurocPipeline({ ...DEFAULT_AUROC_SETTINGS, method: 'speed' }, common, 'social_epochs', social);
    await snap('auroc-speed-matched', matched);
  });
  it('auROC behavior A against B is reported as not on the framework engine yet', () => {
    expect(aurocPipeline({ ...DEFAULT_AUROC_SETTINGS, compare: 'behavior' }, common, 'social_epochs', social).problems[0]).toMatch(/browser engine/);
  });
});
