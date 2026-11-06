// The summary cards of the three Neural QC tests.
import type { MetricCard } from '../components/MetricCards.tsx';
import { tauDecay, tauRise, targetName } from '../lib/decon-state.ts';
import { cellScores, footprints, rejected, tol } from '../lib/store.ts';
import { deconMedian } from './DeconQc.tsx';
import { flaggedCells, overlapPairs } from './NeuralQcShared.tsx';

const median = (v: number[]) => v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)];

export const cellsMetrics = (): MetricCard[] => {
  const scores = cellScores();
  if (!scores) return [];
  const active = scores.filter((s) => !s.rejected);
  const flagged = flaggedCells().length;
  return [
    {
      label: 'Cells',
      value: String(active.length),
      denom: `of ${scores.length} in the traces, ${rejected().size} rejected by you`,
      tone: 'blue',
    },
    {
      label: 'Flagged for review',
      value: String(flagged),
      denom: `of ${active.length} cells, by the automated recommendation`,
      tone: flagged ? 'orange' : 'ok',
    },
    {
      label: 'Median signal to noise',
      value: active.length ? median(active.map((s) => s.snr)).toFixed(1) : 'n/a',
      denom: 'across cells, flagged below 3',
      tone: 'neutral',
    },
    {
      label: 'Rejected by you',
      value: String(rejected().size),
      denom: 'left out of QC and later steps',
      tone: 'purple',
    },
  ];
};

export const footprintMetrics = (): MetricCard[] => {
  const f = footprints();
  if (!f) return [];
  const pairs = overlapPairs().length;
  const active = f.cells - rejected().size;
  return [
    { label: 'Footprints', value: String(f.cells), denom: 'cells in the file', tone: 'blue' },
    {
      label: 'Overlapping pairs',
      value: String(pairs),
      denom: `sharing over half of the smaller footprint, among ${active} cells`,
      tone: pairs ? 'orange' : 'ok',
    },
    {
      label: 'Pair limit',
      value: `${tol.overlapPct}%`,
      denom: 'of cells, set in QC settings',
      tone: 'gray',
    },
    {
      label: 'Rejected by you',
      value: String(rejected().size),
      denom: 'left out of the overlap count',
      tone: 'purple',
    },
  ];
};

export const deconMetrics = (): MetricCard[] => {
  const m = deconMedian();
  return [
    {
      label: 'Median explained',
      value: m === undefined ? 'n/a' : `${(100 * m).toFixed(0)}%`,
      denom: `of the ${targetName()} trace by reconvolved events, limit ${tol.minPve}%`,
      tone: m !== undefined && 100 * m < tol.minPve ? 'fail' : 'neutral',
    },
    {
      label: 'Decay time',
      value: `${tauDecay()} s`,
      denom: 'kernel, set in QC settings',
      tone: 'blue',
    },
    {
      label: 'Rise time',
      value: `${tauRise()} s`,
      denom: 'kernel, set in QC settings',
      tone: 'blue',
    },
  ];
};
