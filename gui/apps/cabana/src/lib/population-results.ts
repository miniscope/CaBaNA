// Population results as the views read them. Everything is read from framework arrays; the pair
// tables only reshape values, null ranges and p-values that the framework computed.

import type { Manifest } from './bridge-client.ts';
import {
  at2,
  finite,
  loadResult,
  significanceLabel,
  type LoadedResult,
  type Nd,
  type ResultSource,
} from './results-load.ts';

export const POPULATION_RESULT = {
  similarity: 'pv_similarity',
  stability: 'pv_stability',
  separation: 'state_separation',
  dimensionality: 'dimensionality',
  pairwise: 'pairwise',
} as const;
export type PopulationResultKey = keyof typeof POPULATION_RESULT;

export interface PairRow {
  a: string;
  b: string;
  value: number | null;
  nullLo: number | null;
  nullHi: number | null;
  p: number | null;
}
export interface MatrixView {
  states: string[];
  values: Nd;
  /** Rows of the upper triangle: each pair of different states once. */
  pairs: PairRow[];
  label: string;
}

function matrixView(r: LoadedResult, metric: string): MatrixView {
  const states = r.meta.state_names ?? [];
  const pairs: PairRow[] = [];
  for (let i = 0; i < states.length; i++)
    for (let j = i + 1; j < states.length; j++)
      pairs.push({
        a: states[i],
        b: states[j],
        value: at2(r.values, i, j),
        nullLo: r.tested?.nullLo ? at2(r.tested.nullLo, i, j) : null,
        nullHi: r.tested?.nullHi ? at2(r.tested.nullHi, i, j) : null,
        p: r.tested ? at2(r.tested.p, i, j) : null,
      });
  return {
    states,
    values: r.values,
    pairs,
    label: significanceLabel(r.tested, {
      metric,
      unit: 'state pair',
      family: `${pairs.length} state pairs tested`,
    }),
  };
}

export interface StabilityView {
  states: string[];
  r: (number | null)[];
  nullLo: (number | null)[];
  nullHi: (number | null)[];
  p: (number | null)[];
  pAdj: (number | null)[] | null;
  /** Population vector of each half for the selected state, from the framework's rate_map_a/b. */
  halves: (state: number) => { a: number[]; b: number[] };
  label: string;
}

export interface SeparationView extends MatrixView {
  varianceExplained: number[];
  cumulative: number[];
  /** Cells x components. */
  loadings?: Nd;
  /** States x components. */
  stateMeans?: Nd;
  nComponents: number;
  /** Cells with the largest absolute loading on a component, from the framework's loadings. */
  topLoadings: (component: number, n: number) => { cell: number; id: string; loading: number }[];
}

export interface DimensionalityView {
  states: string[];
  participationRatio: (number | null)[];
  nullLo: (number | null)[];
  nullHi: (number | null)[];
  p: (number | null)[];
  eigenvalues: Nd;
  cumulativeVariance: number[];
  label: string;
}

export interface PairwiseView {
  cells: number;
  values: Nd;
  meanOffDiagonal: number | null;
  /** Off-diagonal values for the histogram (upper triangle, finite only). */
  offDiagonal: number[];
  label: string;
}

const col = (nd: Nd | null | undefined, n: number) =>
  Array.from({ length: n }, (_, i) => (nd ? (nd.data[i] ?? null) : null));

export async function loadPopulationView(
  src: ResultSource,
  manifest: Manifest,
  key: PopulationResultKey,
) {
  const name = POPULATION_RESULT[key];
  if (!manifest.results.some((r) => r.name === name)) return undefined;
  const r = await loadResult(src, manifest, name);
  const states = r.meta.state_names ?? [];
  switch (key) {
    case 'similarity':
      return matrixView(
        r,
        `Population vector ${(r.meta.params.similarity as string) ?? 'similarity'}`,
      );
    case 'separation': {
      const base = matrixView(r, `${String(r.meta.params.name).replace(/_/g, ' ')} distance`);
      const variance = Array.from(r.extras.variance_explained?.data ?? [], (v) => v ?? 0);
      let running = 0;
      const loadings = r.extras.loadings;
      const ids = r.meta.cell_ids ?? [];
      return {
        ...base,
        varianceExplained: variance,
        cumulative: variance.map((v) => (running += v)),
        loadings,
        stateMeans: r.extras.state_means,
        nComponents: variance.length,
        topLoadings: (component: number, n: number) => {
          if (!loadings) return [];
          const [cells, comps] = loadings.shape;
          return Array.from({ length: cells }, (_, cell) => ({
            cell,
            id: ids[cell] ?? String(cell),
            loading: loadings.data[cell * comps + component] ?? 0,
          }))
            .sort((x, y) => Math.abs(y.loading) - Math.abs(x.loading))
            .slice(0, n);
        },
      } satisfies SeparationView;
    }
    case 'stability': {
      const a = r.extras.rate_map_a;
      const b = r.extras.rate_map_b;
      return {
        states,
        r: col(r.values, states.length),
        nullLo: col(r.tested?.nullLo, states.length),
        nullHi: col(r.tested?.nullHi, states.length),
        p: col(r.tested?.p, states.length),
        pAdj: r.tested?.pAdj ? col(r.tested.pAdj, states.length) : null,
        halves: (state: number) => {
          const cells = a?.shape[0] ?? 0;
          const width = a?.shape[1] ?? 1;
          const pick = (nd?: Nd) =>
            Array.from({ length: cells }, (_, i) => Number(nd?.data[i * width + state] ?? NaN));
          return { a: pick(a), b: pick(b) };
        },
        label: significanceLabel(r.tested, {
          metric: 'Population vector stability (first vs second half)',
          unit: 'state',
          family: 'the states',
        }),
      } satisfies StabilityView;
    }
    case 'dimensionality': {
      const eig = r.extras.eigenvalues;
      const variance = Array.from(r.extras.variance_explained?.data ?? [], (v) => v ?? 0);
      let running = 0;
      return {
        states,
        participationRatio: col(r.values, r.values.shape[0]),
        nullLo: col(r.tested?.nullLo, r.values.shape[0]),
        nullHi: col(r.tested?.nullHi, r.values.shape[0]),
        p: col(r.tested?.p, r.values.shape[0]),
        eigenvalues: eig,
        cumulativeVariance: variance.map((v) => (running += v)),
        label: significanceLabel(r.tested, {
          metric: 'Participation ratio',
          unit: states.length > 1 ? 'state' : 'session',
          family: 'the states',
        }),
      } satisfies DimensionalityView;
    }
    case 'pairwise': {
      const n = r.values.shape[0];
      const off: number[] = [];
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          const v = at2(r.values, i, j);
          if (finite(v)) off.push(v);
        }
      const mean = r.extras.mean_offdiag?.data[0];
      return {
        cells: n,
        values: r.values,
        meanOffDiagonal: mean ?? null,
        offDiagonal: off,
        label: 'Descriptive; no significance test.',
      } satisfies PairwiseView;
    }
  }
}
