// The pipeline for the Population page: one run, one pipeline holding the selected analyses
// (they share the time bin and the target). Field names are the framework's.

import { PREVIEW_SHUFFLES, type PopulationSettings } from '../population-settings.ts';
import { commonSteps, type CommonInput } from './pipeline.ts';

type Obj = Record<string, unknown>;

export interface PopulationContext {
  common: CommonInput;
  /** Keys of the bout tables in session.behavior: the epoch name plus `_epochs` (e.g. `social_epochs`). */
  behaviorSource: string;
  zoneSource: string;
  /** All labels per target, to build a subset list. */
  labels: Record<'behaviors' | 'zones', string[]>;
}

export interface BuiltSpec {
  pipeline: Obj;
  /** Capabilities the framework must have. */
  requires: string[];
  /** Why the run cannot be built (shown as a blocking reason). */
  problems: string[];
  /** Name of the state space the analyses read. */
  target: string;
}

const TARGET = 'population_target';

/** Why the chosen methods cannot run on this target, in words. */
export function populationProblems(s: PopulationSettings, ctx: PopulationContext): string[] {
  const out: string[] = [];
  if (!Object.values(s.methods).some(Boolean)) out.push('Choose at least one method.');
  if (s.target !== 'position') {
    const n = (s.labels.length ? s.labels : ctx.labels[s.target]).length;
    if (n < 2)
      out.push(
        `Population analyses compare states: ${s.target} needs at least 2 labels (found ${n}).`,
      );
  }
  if (s.methods.pairwise && s.pairwiseKind === 'noise' && s.target === 'behaviors')
    out.push(
      'Noise correlation needs exclusive states; behaviors can overlap. Use total or signal correlation.',
    );
  if (s.methods.stability && s.stabilityBlocks < 2) out.push('Stability needs at least 2 blocks.');
  return out;
}

function targetTransforms(s: PopulationSettings, ctx: PopulationContext): Obj[] {
  if (s.target === 'position') return []; // bin_grid comes with the common transforms
  const source = s.target === 'behaviors' ? ctx.behaviorSource : ctx.zoneSource;
  return [
    {
      name: 'bouts_to_states',
      source,
      ...(s.labels.length && { behaviors: s.labels }),
      exclusive: s.target === 'zones',
      output: TARGET,
    },
  ];
}

export function populationPipeline(
  s: PopulationSettings,
  ctx: PopulationContext,
  preview = false,
): BuiltSpec {
  const common = commonSteps(ctx.common, {
    rejected: 'omit',
    grid: s.target === 'position',
    position: s.target === 'position',
  });
  const target = s.target === 'position' ? 'position' : TARGET;
  const nShuffles = preview ? PREVIEW_SHUFFLES : s.shuffles;
  const shuffle = (correction: 'none' | 'max_stat') => ({
    n_shuffles: nShuffles,
    null: {
      name: 'cell_shift',
      min_shift_s: s.minShiftS,
      min_pair_separation_s: s.pairSeparationS,
    },
    seed: s.seed,
    alpha: s.alpha,
    correction,
    n_jobs: -1,
  });
  const analysis = (name: string, metric: Obj, test?: Obj, masks?: string[]): Obj => ({
    name,
    metric,
    states: target,
    ...(masks && { masks }),
    ...(test && { shuffle: test }),
  });
  const masks = s.target === 'position' ? ['speed'] : undefined;
  const maxStat = s.correction;
  const analyses: Obj[] = [];
  if (s.methods.similarity)
    analyses.push(
      analysis(
        'pv_similarity',
        {
          name: 'population_vector_overlap',
          similarity: s.similarity,
          min_occupancy_s: s.pvMinOccupancyS,
          normalize_cells: true,
        },
        shuffle('none'),
        masks,
      ),
    );
  if (s.methods.stability)
    analyses.push(
      analysis(
        'pv_stability',
        { name: 'pv_stability', n_blocks: s.stabilityBlocks, min_occupancy_s: s.pvMinOccupancyS },
        shuffle(maxStat),
        masks,
      ),
    );
  if (s.methods.separation)
    analyses.push(
      s.space === 'pca'
        ? analysis(
            'state_separation',
            {
              name: 'pca_population',
              n_components: s.components,
              zscore: true,
              distance: s.pcaDistance,
              min_frames: 20,
            },
            shuffle('none'),
            masks,
          )
        : analysis(
            'state_separation',
            { name: 'population_distance', distance: s.allDistance, zscore: true },
            shuffle('none'),
            masks,
          ),
    );
  if (s.methods.dimensionality)
    analyses.push(
      analysis(
        'dimensionality',
        {
          name: 'participation_ratio',
          zscore: true,
          min_frames: 50,
          per_state: s.perStateParticipation,
        },
        shuffle(s.perStateParticipation ? maxStat : 'none'),
        masks,
      ),
    );
  if (s.methods.pairwise)
    analyses.push(
      analysis(
        'pairwise',
        {
          name: 'pairwise_correlation',
          kind: s.pairwiseKind,
          method: s.pairwiseMethod,
          min_frames: 50,
          zscore: true,
        },
        undefined,
        masks,
      ),
    );

  return {
    pipeline: {
      transforms: [...common.transforms, ...targetTransforms(s, ctx)],
      // Population bin first, after the common steps that set up the speed mask.
      preprocess: [
        ...common.preprocess,
        { name: 'rebin_time', bin_s: s.binS, activity_method: 'auto', min_fraction: 0.5 },
      ],
      analyses,
    },
    requires: [],
    problems: populationProblems(s, ctx),
    target,
  };
}
