// What the guided Population page shows about its settings: the section list, the review summary and the method text.
import type { JSX } from 'solid-js';
import type { GuidedSection } from '../../components/GuidedSetup.tsx';
import type { SummaryGroup } from '../../components/GuidedReview.tsx';
import { binGrid, effectiveBin } from '../../lib/arena.ts';
import { POPULATION_METHODS, populationSettings as s } from '../../lib/population-settings.ts';
import { neuralSummary, readiness, selectedLabels } from './data.ts';
import { methodSummaries } from './setup-logic.ts';

export const TARGET_NAME = {
  behaviors: 'Behaviors',
  zones: 'Zones',
  position: 'Position bins',
} as const;

/** Number of states the run compares: open grid bins for position, the selected labels otherwise. */
export const stateTotal = () =>
  s.target === 'position'
    ? (binGrid(effectiveBin())?.open.filter(Boolean).length ?? 0)
    : selectedLabels().length;
export const methodCount = () => Object.values(s.methods).filter(Boolean).length;

export function HowPopulationWorks(): JSX.Element {
  return (
    <>
      <p>
        The population analyses compare the pattern of neural values across all cells between
        states: behaviors, zones or position bins. Frames are grouped into time bins, and a
        population vector is the mean value of every cell over the bins of a state.
      </p>
      <p>
        Similarity compares the vectors of two states. Stability correlates a state's vector between
        two interleaved halves of the session. Separation measures the distance between state means,
        in principal components or over all cells. Dimensionality is the participation ratio of the
        cell covariance. Pairwise correlations relate every pair of cells.
      </p>
      <p>
        Significance comes from a circular cell-shift null: each shuffle moves every cell's events
        in time by its own amount, which keeps each cell's timing but breaks its link to the states.
        Max-stat correction covers stability and per-state participation ratio only. Single session;
        cells are not matched across sessions.
      </p>
    </>
  );
}

export const populationSections = (): GuidedSection[] => [
  {
    id: 'target',
    title: 'Target and data',
    summary: `${TARGET_NAME[s.target]} · ${stateTotal()} states · ${s.binS} s bins`,
    attention:
      s.target !== 'position' && stateTotal() < 2 ? 'fewer than 2 usable states' : undefined,
  },
  {
    id: 'methods',
    title: 'Methods',
    summary: `${methodCount()} selected`,
    attention: POPULATION_METHODS.some((m) => s.methods[m.id] && !readiness()[m.id].ready)
      ? 'a selected method is blocked'
      : undefined,
  },
  {
    id: 'stats',
    title: 'Statistical testing',
    summary: `${s.shuffles} shuffles · α ${s.alpha} · shift ≥ ${s.minShiftS} s · ${s.correction === 'max_stat' ? 'max-stat' : 'no correction'}`,
  },
];

export const populationSummary = (): SummaryGroup[] => {
  const n = neuralSummary;
  return [
    {
      title: 'Target and data',
      section: 'target',
      items: [
        { label: 'Target', value: TARGET_NAME[s.target] },
        {
          label: 'States',
          value: `${stateTotal()} (${s.labels.length ? s.labels.join(', ') : 'all usable'})`,
        },
        { label: 'Time bin', value: `${s.binS} s` },
        { label: 'Cells', value: n() ? `${n()!.kept} of ${n()!.total} kept` : '–' },
        { label: 'Neural data', value: 'Deconvolved events, single session' },
      ],
    },
    {
      title: 'Methods',
      section: 'methods',
      items: methodSummaries(s).map((m) => {
        const [name, ...rest] = m.split(' (');
        return { label: name, value: rest.length ? rest.join(' (').replace(/\)$/, '') : 'on' };
      }),
    },
    {
      title: 'Statistical testing',
      section: 'stats',
      items: [
        { label: 'Shuffles', value: s.shuffles.toLocaleString() },
        { label: 'Minimum shift', value: `${s.minShiftS} s` },
        { label: 'Pair separation', value: `${s.pairSeparationS} s` },
        { label: 'Alpha', value: String(s.alpha) },
        {
          label: 'Correction',
          value: s.correction === 'max_stat' ? 'Max-stat (per-state results only)' : 'None',
        },
        { label: 'Seed', value: String(s.seed) },
      ],
    },
  ];
};
