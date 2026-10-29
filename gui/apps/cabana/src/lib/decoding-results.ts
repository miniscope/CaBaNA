// Decoding results as the views read them. The overall value is the framework's own
// (`error_overall`, `accuracy_overall`, `chance_error`, `chance`); without framework F2 it has no
// p-value and says so. Per-bin and per-behavior values come with the framework's p-values.

import type { Manifest } from './bridge-client.ts';
import {
  finite,
  loadResult,
  significanceLabel,
  type Nd,
  type ResultSource,
  type Tested,
} from './results-load.ts';

export const DECODING_RESULT = {
  position: 'decoding_position',
  behavior: 'decoding_behavior',
} as const;
const scalar = (nd?: Nd) => (nd && nd.data.length ? (nd.data[0] ?? null) : null);
const list = (nd: Nd | null | undefined, n: number) =>
  Array.from({ length: n }, (_, i) => (nd ? (nd.data[i] ?? null) : null));

export interface OverallValue {
  value: number | null;
  chance: number | null;
  /** Null until the framework tests the overall value (contract F2). */
  p: number | null;
  testNote: string;
}
const overallNote = (hasTest: boolean) =>
  hasTest
    ? ''
    : 'Overall value not tested (needs framework F2). The per-state tests below are unaffected.';

export interface PositionDecodingView {
  overall: OverallValue;
  nFrames: number | null;
  /** Grid shape of the spatial bins, rows x columns as the framework stored it. */
  gridShape: number[] | null;
  bins: string[];
  medianErrorPerBin: (number | null)[];
  p: (number | null)[];
  pAdj: (number | null)[] | null;
  /** Bins with no value (too few training frames): excluded, with the framework's rule. */
  excluded: boolean[];
  frameError: Nd | undefined;
  confidence: (number | null)[];
  tested: Tested | undefined;
  label: string;
  exclusionRule: string;
}

export interface BehaviorDecodingView {
  overall: OverallValue;
  classifier: string;
  states: string[];
  /** Recall (Bayesian) or the per-behavior score the framework reports. */
  score: (number | null)[];
  p: (number | null)[];
  pAdj: (number | null)[] | null;
  nullLo: (number | null)[];
  nullHi: (number | null)[];
  /** Bayesian: states x states counts. Logistic: one 2 x 2 table per behavior. */
  confusion: Nd | undefined;
  confusionKind: 'matrix' | 'one_vs_rest' | 'none';
  /** Row shares of the Bayesian confusion matrix, for the "normalize rows" display. */
  rowShares: () => number[][] | undefined;
  tested: Tested | undefined;
  label: string;
}

export async function loadPositionDecoding(
  src: ResultSource,
  manifest: Manifest,
  hasOverallTest = false,
): Promise<PositionDecodingView | undefined> {
  const name = DECODING_RESULT.position;
  if (!manifest.results.some((r) => r.name === name)) return undefined;
  const r = await loadResult(src, manifest, name);
  const bins = r.meta.state_names ?? [];
  const prov = r.meta.provenance as { target_shape?: number[] | null };
  const median = list(r.values, bins.length);
  return {
    overall: {
      value: scalar(r.extras.error_overall),
      chance: scalar(r.extras.chance_error),
      p: null,
      testNote: overallNote(hasOverallTest),
    },
    nFrames: scalar(r.extras.n_frames),
    gridShape: prov.target_shape ?? null,
    bins,
    medianErrorPerBin: median,
    p: list(r.tested?.p, bins.length),
    pAdj: r.tested?.pAdj ? list(r.tested.pAdj, bins.length) : null,
    excluded: median.map((v) => !finite(v)),
    frameError: r.extras.error,
    confidence: Array.from(r.extras.posterior_mean_confidence?.data ?? []),
    tested: r.tested,
    label: significanceLabel(r.tested, {
      metric: 'Median decoding error per spatial bin',
      unit: 'spatial bin',
      family: 'eligible spatial bins',
    }),
    exclusionRule:
      'Bins need at least min_frames_per_class frames (framework setting; default 20); occupancy per bin from training data needs framework F5.',
  };
}

export async function loadBehaviorDecoding(
  src: ResultSource,
  manifest: Manifest,
  hasOverallTest = false,
): Promise<BehaviorDecodingView | undefined> {
  const name = DECODING_RESULT.behavior;
  if (!manifest.results.some((r) => r.name === name)) return undefined;
  const r = await loadResult(src, manifest, name);
  const states = r.meta.state_names ?? [];
  const confusion = r.extras.confusion;
  const kind = !confusion ? 'none' : confusion.shape.length === 3 ? 'one_vs_rest' : 'matrix';
  return {
    overall: {
      value: scalar(r.extras.accuracy_overall),
      chance: r.extras.chance ? scalar(r.extras.chance) : null,
      p: null,
      testNote: overallNote(hasOverallTest),
    },
    classifier: String(r.meta.params.name ?? ''),
    states,
    score: list(r.values, states.length),
    p: list(r.tested?.p, states.length),
    pAdj: r.tested?.pAdj ? list(r.tested.pAdj, states.length) : null,
    nullLo: list(r.tested?.nullLo, states.length),
    nullHi: list(r.tested?.nullHi, states.length),
    confusion,
    confusionKind: kind,
    rowShares: () => {
      if (!confusion || kind !== 'matrix') return undefined;
      const [rows, cols] = confusion.shape;
      return Array.from({ length: rows }, (_, i) => {
        const row = Array.from({ length: cols }, (_, j) =>
          Number(confusion.data[i * cols + j] ?? 0),
        );
        const total = row.reduce((s, v) => s + v, 0);
        return row.map((v) => (total ? v / total : 0));
      });
    },
    tested: r.tested,
    label: significanceLabel(r.tested, {
      metric: 'Per-behavior decoding score',
      unit: 'behavior',
      family: 'the decoded behaviors',
    }),
  };
}
