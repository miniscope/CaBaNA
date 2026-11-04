// Plain-language labels for the Decoding setup: section summaries, the Review summary and the
// cards of the Run stage. Pure functions of the settings; nothing here reads the page.

import type { MetricCard } from '../../components/MetricCards.tsx';
import type { SummaryGroup } from '../../components/GuidedReview.tsx';
import { OTHER_NAME } from '../../lib/decoding-settings.ts';
import { correctionFamily } from './logic.ts';
import { gapRecord, type EngineId } from './engines.ts';

/** The settings of the chosen target, as the setup holds them. Fields a decoder does not use are ignored. */
export interface DecodeView {
  target: 'position' | 'behaviors';
  decoder: 'bayesian' | 'logistic';
  likelihood: 'gaussian' | 'poisson';
  sigma: 'per_state' | 'pooled';
  windowS: number;
  smoothSigmaBins: number;
  prior: 'occupancy' | 'uniform';
  mode: 'one_vs_rest' | 'multiclass';
  C: number;
  binS: number;
  folds: number;
  foldGapS: number;
  shuffles: number;
  blockS: number;
  correction: 'max_stat' | 'none';
  alpha: number;
  seed: number;
  minFramesPerClass: number;
  overlap: 'exclude' | 'priority';
  other: boolean;
  /** Behaviors that will be decoded. */
  selected: string[];
}

export const targetName = (v: DecodeView) => (v.target === 'position' ? 'Position' : 'Behavior');

/** "Bayesian (Gaussian, per bin)" or "Logistic regression (one-vs-rest)". */
export function decoderName(v: DecodeView): string {
  if (v.decoder === 'logistic')
    return `Logistic regression (${v.mode === 'multiclass' ? 'multiclass' : 'one-vs-rest'})`;
  if (v.likelihood === 'poisson') return 'Bayesian (Poisson)';
  return `Bayesian (Gaussian, ${v.sigma === 'per_state' ? 'per bin' : 'pooled'})`;
}

/** The classes a behavior run decodes; one behavior with Other reads as "x vs Other". */
export function classText(v: DecodeView): string {
  if (v.other && v.selected.length === 1)
    return `${v.selected[0]} vs Other (all other included frames)`;
  const names = [...v.selected, ...(v.other ? [OTHER_NAME] : [])];
  return names.length ? `${names.length} classes: ${names.join(', ')}` : 'No behaviors selected';
}

const crossValidation = (v: DecodeView) =>
  `${v.folds} train/test splits · ${v.foldGapS > 0 ? `${v.foldGapS} s separation` : 'no temporal gap'}`;

const significance = (v: DecodeView) =>
  `${v.shuffles.toLocaleString()} shuffles · ${v.correction === 'max_stat' ? 'max-stat' : 'uncorrected'} · alpha ${v.alpha}`;

/** The line under each section title in the setup list. */
export function sectionSummary(id: string, v: DecodeView): string {
  switch (id) {
    case 'target':
      return v.target === 'position' ? 'Position' : `Behavior · ${classText(v)}`;
    case 'decoder':
      return decoderName(v);
    case 'folds':
      return crossValidation(v);
    default:
      return significance(v);
  }
}

/** Facts about the loaded data, shown in Review; undefined fields are left out. */
export interface DataFacts {
  cells?: number;
  frames?: number;
  speedCmS?: number;
}

/** Every setting a run uses, grouped by section, each group linking back to where it is edited. */
export function reviewGroups(v: DecodeView, d: DataFacts): SummaryGroup[] {
  const pos = v.target === 'position';
  const decoder: SummaryGroup['items'] = [{ label: 'Decoder', value: decoderName(v) }];
  if (v.decoder === 'bayesian') {
    decoder.push({ label: 'Window', value: `${v.windowS} s` });
    if (pos) decoder.push({ label: 'Map smoothing', value: `${v.smoothSigmaBins} bins` });
    decoder.push({ label: 'Prior', value: v.prior === 'occupancy' ? 'Occupancy' : 'Uniform' });
  } else {
    decoder.push({ label: 'C', value: String(v.C) }, { label: 'Time bin', value: `${v.binS} s` });
  }
  const target: SummaryGroup['items'] = [
    { label: 'Target', value: targetName(v) },
    pos
      ? {
          label: 'Minimum speed',
          value: `${d.speedCmS ?? '–'} cm/s`,
          note: 'shared with Preprocess',
        }
      : { label: 'Classes', value: classText(v) },
    {
      label: pos ? 'Minimum frames per bin' : 'Minimum frames per class',
      value: String(v.minFramesPerClass),
    },
  ];
  if (!pos)
    target.push({
      label: 'Overlapping behaviors',
      value: v.overlap === 'exclude' ? 'Excluded' : 'Priority list',
    });
  return [
    { title: 'Target and data', section: 'target', items: target },
    { title: 'Decoder', section: 'decoder', items: decoder },
    {
      title: 'Train and test',
      section: 'folds',
      items: [
        { label: 'Train/test splits', value: String(v.folds), note: 'blocked, never random' },
        { label: 'Training/test separation', value: gapRecord(v.foldGapS) },
      ],
    },
    {
      title: 'Significance',
      section: 'significance',
      items: [
        { label: 'Shuffles', value: v.shuffles.toLocaleString() },
        { label: 'Block length', value: `${v.blockS} s` },
        {
          label: 'Correction',
          value:
            v.correction === 'max_stat'
              ? `Max-stat ${correctionFamily(v.target)}`
              : 'None (exploratory)',
        },
        { label: 'Alpha', value: String(v.alpha) },
        { label: 'Seed', value: String(v.seed) },
      ],
    },
    {
      title: 'Data',
      items: [
        { label: 'Cells', value: d.cells === undefined ? '–' : `${d.cells} accepted` },
        {
          label: 'Frames',
          value: d.frames === undefined ? '–' : `${d.frames.toLocaleString()} used`,
        },
      ],
    },
  ];
}

/** What the last run was, as the cards of the Run stage. */
export interface LastRun {
  engine: EngineId;
  preliminary: boolean;
  shuffles?: number;
  foldGapS?: number;
  outdated: boolean;
}
export function runCards(r: LastRun): MetricCard[] {
  return [
    { label: 'Engine', value: r.engine === 'framework' ? 'Framework' : 'Browser', tone: 'blue' },
    {
      label: 'Analysis',
      value: r.preliminary ? 'Preliminary' : 'Full',
      denom:
        r.shuffles === undefined
          ? 'shuffle count not recorded'
          : `${r.shuffles.toLocaleString()} shuffles`,
      tone: r.preliminary ? 'warn' : 'neutral',
    },
    {
      label: 'Training/test separation',
      value: r.foldGapS === undefined ? '–' : r.foldGapS > 0 ? `${r.foldGapS} s` : 'None',
      denom: r.foldGapS === 0 ? 'no temporal gap' : undefined,
      tone: r.foldGapS === 0 ? 'gray' : 'neutral',
    },
    {
      label: 'Settings',
      value: r.outdated ? 'Changed' : 'Current',
      denom: r.outdated ? 'since this run; run again to update' : 'match this run',
      tone: r.outdated ? 'warn' : 'ok',
    },
  ];
}
