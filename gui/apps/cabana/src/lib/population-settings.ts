// Population analysis settings (plan D-25 to D-29). Defaults follow the framework's `population`
// recipe: 0.5 s time bin, circular cell-shift null, 200 shuffles, no correction.

import { createStore, reconcile } from 'solid-js/store';
import { rangeIssue, type Range } from './ranges.ts';
import { onClear } from './store.ts';
import { SETTINGS_VERSION } from './settings-hash.ts';

export type PopulationTarget = 'behaviors' | 'zones' | 'position';
export type PopulationMethod =
  'similarity' | 'stability' | 'separation' | 'dimensionality' | 'pairwise';

export const POPULATION_METHODS: { id: PopulationMethod; label: string }[] = [
  { id: 'similarity', label: 'Population vector similarity' },
  { id: 'stability', label: 'Population vector stability' },
  { id: 'separation', label: 'State separation' },
  { id: 'dimensionality', label: 'Dimensionality' },
  { id: 'pairwise', label: 'Pairwise correlations' },
];

export const DEFAULT_POPULATION = {
  settingsVersion: SETTINGS_VERSION,
  target: 'behaviors' as PopulationTarget,
  /** Labels to include; empty means every label of the target. */
  labels: [] as string[],
  /** Time bin (s), used only by population analyses. */
  binS: 0.5,
  methods: {
    similarity: true,
    stability: true,
    separation: true,
    dimensionality: true,
    pairwise: false,
  } as Record<PopulationMethod, boolean>,
  similarity: 'cosine' as 'cosine' | 'pearson',
  pvMinOccupancyS: 0.05,
  stabilityBlocks: 2,
  space: 'pca' as 'pca' | 'all',
  components: 10,
  pcaDistance: 'euclidean' as 'euclidean' | 'mahalanobis',
  allDistance: 'euclidean' as 'euclidean' | 'correlation',
  perStateParticipation: false,
  pairwiseKind: 'total' as 'total' | 'signal' | 'noise',
  pairwiseMethod: 'pearson' as 'pearson' | 'spearman',
  shuffles: 200,
  minShiftS: 20,
  pairSeparationS: 1,
  seed: 0,
  alpha: 0.05,
  /** max_stat applies to the per-state results only (stability, per-state participation ratio). */
  correction: 'none' as 'none' | 'max_stat',
};
export type PopulationSettings = typeof DEFAULT_POPULATION;

export type PopulationNumKey =
  | 'binS'
  | 'pvMinOccupancyS'
  | 'stabilityBlocks'
  | 'components'
  | 'shuffles'
  | 'minShiftS'
  | 'pairSeparationS'
  | 'seed'
  | 'alpha';

/** Valid range and name of each numeric setting. */
export const POPULATION_RANGES: Record<PopulationNumKey, Range & { name: string }> = {
  binS: { name: 'Time bin', min: 0.05 },
  pvMinOccupancyS: { name: 'Minimum time in state', min: 0 },
  stabilityBlocks: { name: 'Blocks', min: 1, whole: true },
  components: { name: 'Number of components', min: 1, whole: true },
  shuffles: { name: 'Shuffles', min: 10, whole: true },
  minShiftS: { name: 'Minimum shift', min: 0 },
  pairSeparationS: { name: 'Pair separation', min: 0 },
  seed: { name: 'Seed', min: 0, whole: true },
  alpha: { name: 'Alpha', min: 0.0001, max: 0.5 },
};

/** Settings the run would use that are outside their range, as reasons. */
export function populationSettingIssues(s: PopulationSettings): string[] {
  const used: PopulationNumKey[] = ['binS', 'shuffles', 'minShiftS', 'seed', 'alpha'];
  if (s.methods.similarity) used.push('pvMinOccupancyS');
  if (s.methods.stability) used.push('stabilityBlocks');
  if (s.methods.dimensionality && s.space === 'pca') used.push('components');
  if (s.methods.pairwise) used.push('pairSeparationS');
  return used
    .map((k) => rangeIssue(POPULATION_RANGES[k].name, s[k], POPULATION_RANGES[k]))
    .filter((m): m is string => !!m);
}

export const [populationSettings, setPopulationSettings] = createStore<PopulationSettings>(
  structuredClone(DEFAULT_POPULATION),
);
onClear(() => setPopulationSettings(reconcile(structuredClone(DEFAULT_POPULATION))));

/** Settings read from a saved record: missing fields take the defaults; a newer version is refused. */
export function readPopulationSettings(saved: unknown): PopulationSettings | { error: string } {
  const s = (saved ?? {}) as Partial<PopulationSettings>;
  if ((s.settingsVersion ?? 1) > SETTINGS_VERSION)
    return { error: 'Saved by a newer GUI; update to open.' };
  return {
    ...structuredClone(DEFAULT_POPULATION),
    ...s,
    methods: { ...DEFAULT_POPULATION.methods, ...s.methods },
  };
}
