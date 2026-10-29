// Place-cell and auROC pipelines for the framework engine (plan P8). They mirror the bundled
// recipes `place_cell` and `social` / `social_speed_matched` at the pinned framework commit; a
// pytest compares the default output with `recipe_pipeline` so the two cannot drift apart. The
// Place cells and auROC pages run them on the framework engine (lib/engine.ts says when not).

import type { AurocSettings } from '../auroc-run.ts';
import type { DEFAULT_PLACE_SETTINGS } from '../place-run.ts';
import { commonSteps, type CommonInput } from './pipeline.ts';

type Obj = Record<string, unknown>;
type PlaceSettings = typeof DEFAULT_PLACE_SETTINGS;

const cellShift = (
  minShiftS: number,
  shuffles: number,
  seed: number,
  alpha: number,
  correction: string,
  nullSpec?: Obj,
): Obj => ({
  n_shuffles: shuffles,
  ...(nullSpec && { null: nullSpec }),
  min_shift_s: minShiftS,
  seed,
  alpha,
  correction,
  correction_scope: 'states',
  n_jobs: -1,
});

export function placePipeline(
  s: PlaceSettings,
  common: CommonInput,
  binCm: number,
): { pipeline: Obj; problems: string[] } {
  const steps = commonSteps({ ...common, binCm }, { rejected: 'omit' });
  const selectors: Obj[] = [];
  if (s.sigmaAuto) selectors.push({ name: 'auto_smooth_sigma', states: 'position' });
  if (s.shiftAuto) selectors.push({ name: 'auto_null_timescale' });
  const shuffle = cellShift(s.minShiftS, s.nShuffles, s.seed, s.alpha, 'none');
  const sigma = s.sigmaAuto ? 0 : s.sigma;
  const analysis = (name: string, metric: Obj): Obj => ({
    name,
    metric,
    states: 'position',
    masks: ['speed'],
    shuffle,
  });
  return {
    pipeline: {
      transforms: steps.transforms,
      preprocess: steps.preprocess,
      selectors,
      analyses: [
        analysis('information', {
          name: 'information_content',
          min_occupancy_s: s.minOccS,
          smooth_sigma_bins: sigma,
        }),
        analysis('stability', {
          name: 'split_half_stability',
          n_blocks: 2,
          min_occupancy_s: s.minOccS,
          smooth_sigma_bins: sigma,
        }),
        analysis('fields', {
          name: 'place_fields',
          smooth_sigma_bins: s.sigmaAuto ? 1 : s.sigma,
          min_occupancy_s: s.minOccFieldsS,
          threshold: s.fieldThreshold,
          min_field_bins: s.minFieldBins,
        }),
      ],
    },
    problems: common.hasArenaBox
      ? []
      : ['Place cells need the arena outline (Experimental setup, Spatial).'],
  };
}

/** auROC of each behavior against all other frames. Behavior A against B stays on the browser engine until masks reproduce it. */
export function aurocPipeline(
  s: AurocSettings,
  common: CommonInput,
  behaviorSource: string,
  labels: string[],
): { pipeline: Obj; problems: string[] } {
  const selected = labels.filter((l) => !s.unselected.includes(l));
  // auROC has its own minimum speed (not the Preprocess one), used only when its speed filter is on.
  const steps = commonSteps(
    { ...common, minSpeed: s.speedFilter ? s.minSpeed : common.minSpeed },
    { rejected: 'omit', grid: false, position: s.speedFilter || s.method === 'speed' },
  );
  const speedMatched = s.method === 'speed';
  const nullSpec = speedMatched
    ? {
        name: 'covariate_matched_shift',
        min_shift_s: s.minShiftS,
        covariate: 'speed',
        statistic: s.match.statistic,
        tolerance: s.match.tolerance,
        max_tries: s.match.maxTries,
        min_frames: s.match.minFrames,
      }
    : undefined;
  const shuffle = cellShift(s.minShiftS, s.nShuffles, s.seed, s.alpha, s.correction, nullSpec);
  const problems: string[] = [];
  if (s.compare === 'behavior')
    problems.push('Behavior A against behavior B runs on the browser engine for now.');
  if (selected.length < 1) problems.push('Select at least one behavior.');
  return {
    pipeline: {
      transforms: [
        ...steps.transforms,
        {
          name: 'bouts_to_states',
          source: behaviorSource,
          behaviors: selected,
          exclusive: false,
          output: 'auroc_target',
        },
      ],
      preprocess: steps.preprocess,
      // The framework's automatic timescale acts on circular shifts only; speed matching keeps `min_shift_s`.
      selectors: s.shiftAuto && !speedMatched ? [{ name: 'auto_null_timescale' }] : [],
      analyses: [
        {
          name: 'auroc',
          metric: { name: 'auroc', min_frames: 20 },
          states: 'auroc_target',
          ...(s.speedFilter && { masks: ['speed'] }),
          shuffle,
        },
      ],
    },
    problems,
  };
}
