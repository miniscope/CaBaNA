// Connects the stores to the project files: what processing.yaml and analysis.yaml hold now, and
// putting a saved copy back. The file formats and the history wording are in project-files.ts.

import { reconcile } from 'solid-js/store';
import { arena, setArena } from './arena.ts';
import { aurocSettings, setAurocSettings } from './auroc-run.ts';
import {
  indicatorId,
  setIndicator,
  setTauDecay,
  setTauRise,
  tauDecay,
  tauRise,
} from './decon-state.ts';
import {
  behaviorDecoding,
  decodeTarget,
  positionDecoding,
  setBehaviorDecoding,
  setDecodeTarget,
  setPositionDecoding,
} from './decoding-settings.ts';
import { pethSettings, setPethSettings } from './peth-run.ts';
import { placeSettings, setPlaceSettings } from './place-run.ts';
import { populationSettings, setPopulationSettings } from './population-settings.ts';
import { excludedFrames, keptFrames, restoreChoices } from './position-corrections.ts';
import { prep, setPrep } from './preprocess.ts';
import {
  analysisFromData,
  processingFromData,
  type AnalysisSections,
  type PrepValues,
  type ProcessingState,
} from './project-files.ts';
import { reviewed, setReviewed } from './qc-view.ts';
import {
  annotationFixed,
  editAnnotations,
  maxSpeed,
  proceed,
  rejected,
  rejectReasons,
  restoreRejected,
  setMaxSpeed,
  setProceed,
  setTol,
  tol,
  type Section,
} from './store.ts';

// Store values are proxies; the project files are plain JSON.
const copy = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const trueKeys = (o: Record<string, boolean>) =>
  Object.entries(o)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .sort();

/** The QC decisions and preprocessing settings in force now. */
export function captureProcessing(): ProcessingState {
  return {
    rejectedCells: [...rejected()].sort((a, b) => a - b),
    rejectReasons: copy(rejectReasons()) as Record<number, string>,
    excludeFrames: [...excludedFrames()],
    keptFrames: [...keptFrames()],
    annotationFixes: { ...annotationFixed() },
    reviewed: trueKeys(reviewed),
    continued: trueKeys(proceed),
    limits: { tol: copy(tol) as Record<string, number>, maxSpeed: maxSpeed() },
    prep: copy(prep) as PrepValues,
    decon: { indicator: indicatorId(), tauRise: tauRise(), tauDecay: tauDecay() },
  };
}

/** Put a saved processing.yaml back. Call after the session's files are loaded. */
export function applyProcessing(raw: unknown): void {
  const s = processingFromData(raw, captureProcessing());
  restoreRejected(s.rejectedCells, s.rejectReasons);
  restoreChoices(s.excludeFrames, s.keptFrames);
  setTol(s.limits.tol);
  setMaxSpeed(s.limits.maxSpeed);
  setPrep(s.prep);
  setIndicator(s.decon.indicator);
  setTauRise(s.decon.tauRise);
  setTauDecay(s.decon.tauDecay);
  setReviewed(reconcile(Object.fromEntries(s.reviewed.map((k) => [k, true]))));
  for (const k of ['position', 'annotations', 'cells', 'decon'] as Section[])
    setProceed(k, s.continued.includes(k));
  // The fixes are redone from the files with the saved limits above.
  if (s.annotationFixes.merge && !annotationFixed().merge) editAnnotations('merge');
  if (s.annotationFixes.drop && !annotationFixed().drop) editAnnotations('drop');
}

/** The settings of the five analyses, in full (selections included: they belong to this data). */
export function captureAnalysis(): AnalysisSections {
  return {
    place_cells: {
      settings: copy(placeSettings),
      bin_cm: arena.binCm,
      min_time_per_bin_s: arena.minOccupancy,
    },
    auroc: copy(aurocSettings),
    peth: copy(pethSettings),
    population: copy(populationSettings),
    decoding: {
      target: decodeTarget.type,
      position: copy(positionDecoding),
      behaviors: copy(behaviorDecoding),
    },
  };
}

type Obj = Record<string, never>;

/** Put saved analysis settings back; a section the file lacks keeps its current values. */
export function applyAnalysis(raw: unknown): void {
  const a = analysisFromData(raw) as Record<string, Obj>;
  const place = a.place_cells;
  if (place) {
    if (place.settings) setPlaceSettings(copy(place.settings));
    if (typeof place.bin_cm === 'number') setArena('binCm', place.bin_cm);
    if (typeof place.min_time_per_bin_s === 'number')
      setArena('minOccupancy', place.min_time_per_bin_s);
  }
  if (a.auroc) setAurocSettings(copy(a.auroc));
  if (a.peth) setPethSettings(copy(a.peth));
  if (a.population) setPopulationSettings(copy(a.population));
  const d = a.decoding as { target?: never; position?: Obj; behaviors?: Obj } | undefined;
  if (d) {
    if (d.position) setPositionDecoding(reconcile(copy(d.position) as never));
    if (d.behaviors) setBehaviorDecoding(copy(d.behaviors) as never);
    if (d.target) setDecodeTarget('type', d.target);
  }
}
