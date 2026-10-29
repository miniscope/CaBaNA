// Which preprocessing steps each analysis uses. The Preprocess page, the analysis pages and the
// "results out of date" checks all read this table, so a new analysis only needs its own entry.
// Every entry follows what the analysis's input code reads (placeFrames/placeNeural in
// prepared.ts, aurocData in auroc-run.ts), not what the step's name suggests.

import { DEFAULT_PREP, prep } from './preprocess.ts';

export type StepId =
  | 'positionOnFrames'
  | 'speed'
  | 'boutLabels'
  | 'eventSmooth'
  | 'fillGaps'
  | 'posSmooth'
  | 'boutPad'
  | 'speedFilter'
  | 'spatialBins';

export type PrepKey = keyof typeof DEFAULT_PREP;

/**
 * automatic: always runs when its input is loaded. optional: off unless turned on (value 0 = off).
 * analysis: a setting that belongs to the analyses that use it, shown read-only on Preprocess.
 * `keys` are the `prep` values the step reads; spatial bins live in `arena` instead.
 */
export const STEPS: Record<StepId, { label: string; kind: 'automatic' | 'optional' | 'analysis'; keys: PrepKey[] }> = {
  positionOnFrames: { label: 'Position onto neural frames', kind: 'automatic', keys: ['maxGapS'] },
  speed: { label: 'Speed estimate', kind: 'automatic', keys: ['speedWindowS'] },
  boutLabels: { label: 'Bouts to frame labels', kind: 'automatic', keys: [] },
  eventSmooth: { label: 'Event smoothing', kind: 'optional', keys: ['eventSigmaS'] },
  fillGaps: { label: 'Fill tracking gaps', kind: 'optional', keys: ['fillGapS'] },
  posSmooth: { label: 'Position smoothing', kind: 'optional', keys: ['posMethod', 'posWindowS'] },
  boutPad: { label: 'Bout padding', kind: 'optional', keys: ['labelPadS'] },
  speedFilter: { label: 'Speed filter', kind: 'analysis', keys: ['minSpeed'] },
  spatialBins: { label: 'Spatial bins', kind: 'analysis', keys: [] },
};

/**
 * required: always read. optional: read, and changes the result only when the step is on.
 * conditional: read only under `when`. Steps an analysis does not list are not used by it.
 * Trace smoothing (`traceSigmaS`) is listed nowhere: no analysis reads traces yet.
 */
export type Use = { use: 'required' | 'optional' } | { use: 'conditional'; when: string };

export const DEPS: Record<'place' | 'auroc' | 'peth', Partial<Record<StepId, Use>>> = {
  // placeFrames: a frame is used only with a position in an open bin and speed >= minSpeed.
  place: {
    positionOnFrames: { use: 'required' },
    speed: { use: 'required' },
    eventSmooth: { use: 'optional' },
    fillGaps: { use: 'optional' },
    posSmooth: { use: 'optional' },
    speedFilter: { use: 'required' },
    spatialBins: { use: 'required' },
  },
  // aurocData: position and speed are read only when the auROC speed filter is ticked. Its minimum
  // speed is auROC's own setting, so the Preprocess minimum speed is not read.
  auroc: {
    boutLabels: { use: 'required' },
    eventSmooth: { use: 'optional' },
    boutPad: { use: 'optional' },
    positionOnFrames: { use: 'conditional', when: 'with its speed filter' },
    speed: { use: 'conditional', when: 'with its speed filter' },
    fillGaps: { use: 'conditional', when: 'with its speed filter' },
    posSmooth: { use: 'conditional', when: 'with its speed filter' },
  },
  // pethData: onsets come from the unpadded frame labels; no position, speed or frame selection.
  peth: {
    boutLabels: { use: 'required' },
    eventSmooth: { use: 'optional' },
  },
};

export const ANALYSIS_LABEL: Record<keyof typeof DEPS, string> = { place: 'Place cells', auroc: 'auROC', peth: 'PETH' };

/** The analyses that use a step, with the condition when there is one. */
export const usedBy = (step: StepId) =>
  (Object.keys(DEPS) as (keyof typeof DEPS)[]).flatMap((id) => {
    const u = DEPS[id][step];
    return u ? [{ id, label: ANALYSIS_LABEL[id], when: u.use === 'conditional' ? u.when : undefined }] : [];
  });

/**
 * Steps whose `prep` values differ from `before` (a copy of `prep` taken when the analysis ran),
 * among the steps the analysis reads. `conditionsOn` says whether its conditional uses applied.
 */
export function prepChanges(id: keyof typeof DEPS, before: typeof DEFAULT_PREP, conditionsOn: boolean): string[] {
  return (Object.entries(DEPS[id]) as [StepId, Use][])
    .filter(([s, u]) => (u.use !== 'conditional' || conditionsOn) && STEPS[s].keys.some((k) => prep[k] !== before[k]))
    .map(([s]) => STEPS[s].label.toLowerCase());
}
