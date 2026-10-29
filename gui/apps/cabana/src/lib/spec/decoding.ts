// Decoding pipelines (plan 6.2, D-20, D-22). The Bayesian decoder reads unsmoothed deconvolved
// events: no `smooth_activity` step is written and the bridge refuses the run if anything before
// the decoder changes the events. Logistic regression gets its own time bin from `rebin_time`.

import {
  OTHER_NAME,
  PREVIEW_DECODING_SHUFFLES,
  type BehaviorDecoding,
  type CommonDecoding,
  type PositionDecoding,
} from '../decoding-settings.ts';
import type { CapabilityName } from '../bridge-client.ts';
import { commonSteps } from './pipeline.ts';
import type { BuiltSpec, PopulationContext } from './population.ts';

type Obj = Record<string, unknown>;
const TARGET = 'decoding_target';

export interface DecodingContext extends PopulationContext {
  /** Framework features present; fields for missing ones are left out (the run is gated anyway). */
  has: (c: CapabilityName) => boolean;
}

const test = (c: CommonDecoding, n: number): Obj => ({
  n_shuffles: n,
  null: { name: 'label_shuffle', block_s: c.blockS },
  seed: c.seed,
  alpha: c.alpha,
  correction: c.correction,
  correction_scope: 'states',
  n_jobs: -1,
});

/** Without the smoothing step: decoding never smooths the events. */
const withoutSmoothing = (steps: Obj[]) => steps.filter((s) => s.name !== 'smooth_activity');

export function positionDecodingPipeline(
  s: PositionDecoding,
  ctx: DecodingContext,
  preview = false,
): BuiltSpec {
  const common = commonSteps(ctx.common, { rejected: 'omit' });
  const metric: Obj = {
    name: 'bayesian_decoder',
    likelihood: s.likelihood,
    binarize: true,
    window_s: s.windowS,
    smooth_sigma_bins: s.smoothSigmaBins,
    n_folds: s.folds,
    sigma: s.sigma,
    prior: s.prior,
    min_frames_per_class: s.minFramesPerClass,
    ...(ctx.has('decoding_fold_gap') && { fold_gap_s: s.foldGapS }),
  };
  return {
    pipeline: {
      transforms: common.transforms,
      preprocess: withoutSmoothing(common.preprocess),
      analyses: [
        {
          name: 'decoding_position',
          metric,
          states: 'position',
          masks: ['speed'],
          shuffle: test(s, preview ? PREVIEW_DECODING_SHUFFLES : s.shuffles),
        },
      ],
    },
    requires: ['decoding_fold_gap'],
    problems: ctx.common.hasArenaBox
      ? []
      : ['Position decoding needs the arena outline (Experimental setup, Spatial).'],
    target: 'position',
  };
}

export function behaviorDecodingPipeline(
  s: BehaviorDecoding,
  ctx: DecodingContext,
  preview = false,
): BuiltSpec {
  const common = commonSteps(ctx.common, { rejected: 'omit', grid: false, position: false });
  const labels = s.labels.length ? s.labels : ctx.labels.behaviors;
  const requires = ['decoding_fold_gap', ...(s.overlap === 'exclude' ? ['overlap_policy'] : [])];
  const toStates: Obj = {
    name: 'bouts_to_states',
    source: ctx.behaviorSource,
    behaviors: labels,
    exclusive: true,
    add_rest: s.other,
    rest_name: OTHER_NAME,
    output: TARGET,
    ...(ctx.has('overlap_policy') && { overlap: s.overlap }),
  };
  const bayes = s.decoder === 'bayesian';
  const metric: Obj = bayes
    ? {
        name: 'bayesian_decoder',
        likelihood: s.likelihood,
        binarize: true,
        window_s: s.windowS,
        n_folds: s.folds,
        sigma: s.sigma,
        prior: s.prior,
        min_frames_per_class: s.minFramesPerClass,
        ...(ctx.has('decoding_fold_gap') && { fold_gap_s: s.foldGapS }),
      }
    : {
        name: 'decode_states',
        classifier: 'logistic',
        mode: s.mode,
        C: s.C,
        n_folds: s.folds,
        zscore: true,
        ...(ctx.has('decoding_fold_gap') && { fold_gap_s: s.foldGapS }),
      };
  const preprocess = withoutSmoothing(common.preprocess);
  if (!bayes)
    preprocess.push({
      name: 'rebin_time',
      bin_s: s.binS,
      activity_method: 'auto',
      min_fraction: 0.5,
    });
  const problems: string[] = [];
  if (labels.length < 2) problems.push('Behavior decoding needs at least 2 behaviors.');
  if (!bayes && s.mode === 'multiclass' && !ctx.has('overlap_policy'))
    problems.push('Multiclass logistic regression needs exclusive states (framework F3).');
  return {
    pipeline: {
      transforms: [...common.transforms, toStates],
      preprocess,
      analyses: [
        {
          name: 'decoding_behavior',
          metric,
          states: TARGET,
          shuffle: test(s, preview ? PREVIEW_DECODING_SHUFFLES : s.shuffles),
        },
      ],
    },
    requires,
    problems,
    target: TARGET,
  };
}
