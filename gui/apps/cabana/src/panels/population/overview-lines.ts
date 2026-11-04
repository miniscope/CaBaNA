// The one-line result of each population analysis, read from the saved framework arrays.

import type { Manifest } from '../../lib/bridge-client.ts';
import {
  loadPopulationView,
  POPULATION_RESULT,
  type DimensionalityView,
  type MatrixView,
  type PairwiseView,
  type StabilityView,
} from '../../lib/population-results.ts';
import type { PopulationMethod } from '../../lib/population-settings.ts';
import type { ResultSource } from '../../lib/results-load.ts';
import {
  dimensionalityLine,
  matrixLine,
  pairwiseLine,
  stabilityLine,
  type OverviewLine,
} from './setup-logic.ts';

export async function lineOf(
  src: ResultSource,
  manifest: Manifest,
  method: PopulationMethod,
): Promise<OverviewLine | undefined> {
  const meta = manifest.results.find((r) => r.name === POPULATION_RESULT[method]);
  const view = await loadPopulationView(src, manifest, method);
  if (!view || !meta) return undefined;
  const rec = (meta.shuffle ?? {}) as { alpha?: number; correction?: string };
  const alpha = rec.alpha ?? 0.05;
  const corrected = !!rec.correction && rec.correction !== 'none';
  switch (method) {
    case 'similarity':
      return matrixLine(view as MatrixView, alpha, 'more similar than the null');
    case 'separation':
      return matrixLine(view as MatrixView, alpha, 'farther apart than the null');
    case 'stability':
      return stabilityLine(view as StabilityView, alpha, corrected);
    case 'dimensionality':
      return dimensionalityLine(view as DimensionalityView, !!meta.params.per_state);
    case 'pairwise':
      return pairwiseLine(view as PairwiseView);
  }
}
