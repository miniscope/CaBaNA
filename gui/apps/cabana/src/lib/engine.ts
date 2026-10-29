// Which engine runs Place cells and auROC for the current settings, how results name it, and
// whether the latest framework run still matches the settings. Nothing falls back silently: when
// the framework is chosen and the Python engine is off, the page says so and offers the browser
// engine as a separate, labeled action.

import { createEffect, createRoot, createSignal } from 'solid-js';
import { aurocOutcome, aurocSettings } from './auroc-run.ts';
import { placeOutcome } from './place-run.ts';
import { bridgeState } from './bridge-status.ts';
import { cachedRecords } from './results-store.ts';
import { compareToRecord, latest, setLatest, type AnalysisId } from './runs.ts';
import { labelRegistry, rejected, source } from './store.ts';
import { prep } from './preprocess.ts';

export type EngineId = 'framework' | 'browser';
export type EngineMode = Extract<AnalysisId, 'place' | 'auroc'>;

export const FRAMEWORK_ENGINE_TEXT = 'Python framework (same command as `cabana run`)';
export const BROWSER_ENGINE_TEXT =
  'Browser engine (TypeScript port of framework 57c0c4b, with approved GUI extensions)';
export const engineText = (e: EngineId) =>
  e === 'framework' ? FRAMEWORK_ENGINE_TEXT : BROWSER_ENGINE_TEXT;
export const BROWSER_RUN_LABEL = 'Run in browser engine (different random draws)';

/** Why the current settings cannot use the framework, or undefined when they can. */
export function browserReason(mode: EngineMode): string | undefined {
  if (mode === 'place')
    return source.positionUnit === 'px'
      ? 'Positions are in pixels, which the framework path does not convert yet. Place cells runs on the browser engine.'
      : undefined;
  return aurocSettings.compare === 'behavior'
    ? 'Behavior A against behavior B has no framework pipeline yet. It runs on the browser engine.'
    : undefined;
}

export const engineFor = (mode: EngineMode): EngineId =>
  browserReason(mode) ? 'browser' : 'framework';

/** The Python engine is running. */
export const frameworkReady = () => bridgeState().kind === 'ready';

// ---- does the framework run on screen match the settings? ------------------------------------

export interface RunMatch {
  matches: boolean;
  diff: string[];
}
const [matchOf, setMatchOf] = createSignal<
  Partial<Record<EngineMode, RunMatch & { runId: string }>>
>({});
/** The framework run each page shows (undefined for browser results and before a run). */
const shownRecord = (mode: EngineMode) =>
  mode === 'place' ? placeOutcome()?.record : aurocOutcome()?.record;
/** The settings-hash comparison of the run on screen, once it has been computed. */
export const runMatch = (mode: EngineMode): RunMatch | undefined => {
  const m = matchOf()[mode];
  return m && m.runId === shownRecord(mode)?.run_id ? m : undefined;
};

/** Recompute after any input of the hash changes. The token drops answers that arrive late. */
const tokens: Record<EngineMode, number> = { place: 0, auroc: 0 };
function trackMatch(mode: EngineMode): void {
  createEffect(() => {
    // Read what the hash is built from, so the effect reruns when any of it changes.
    void [rejected(), JSON.stringify(prep), labelRegistry().length];
    const record = shownRecord(mode);
    const mine = ++tokens[mode];
    if (!record) return;
    void compareToRecord(mode, record)
      .then(
        (m) =>
          m &&
          mine === tokens[mode] &&
          setMatchOf((s) => ({ ...s, [mode]: { ...m, runId: record.run_id } })),
      )
      .catch(() => undefined);
  });
}

/** Saved results stay openable with the Python engine off: the newest record of the mode comes from this browser's copy. */
async function loadCachedLatest(mode: EngineMode): Promise<void> {
  if (latest[mode]) return;
  // the cached list is newest first
  const saved = (await cachedRecords()).find((r) => r.analysis === mode);
  if (saved && !latest[mode]) setLatest(mode, saved);
}

let tracking = false;
/** Start comparing the latest runs with the settings. Idempotent; the pages call it. */
export function startRunTracking(): void {
  if (tracking) return;
  tracking = true;
  createRoot(() => {
    trackMatch('place');
    trackMatch('auroc');
    createEffect(() => {
      if (bridgeState().kind === 'offline') {
        void loadCachedLatest('place');
        void loadCachedLatest('auroc');
      }
    });
  });
}

const PREP_LABELS: Record<string, string> = {
  eventSigmaS: 'event smoothing',
  labelPadS: 'behavior label padding',
  fillGapS: 'position gap filling',
  maxGapS: 'position gap filling',
  posMethod: 'position smoothing',
  posWindowS: 'position smoothing',
  speedWindowS: 'speed window',
  minSpeed: 'minimum speed',
};

/** Words for the lines of a settings diff (`analysis.alpha: 0.05 -> 0.01`), each setting once. */
export function describeChanges(diff: string[], labels: Record<string, string>): string[] {
  const words = diff.map((line) => {
    const [root, key] = line.split(':')[0].split('.');
    if (root === 'analysis') return labels[key] ?? key;
    if (root === 'prep') return PREP_LABELS[key] ?? `Preprocess ${key}`;
    if (root === 'inputs') return 'input files';
    if (root === 'rejected') return 'rejected cells';
    if (root === 'labelRoles') return 'label roles';
    return root;
  });
  return [...new Set(words)];
}

export const PLACE_LABELS: Record<string, string> = {
  nShuffles: 'number of shuffles',
  alpha: 'significance threshold',
  fieldThreshold: 'fraction of peak',
  minFieldBins: 'smallest region',
  minOccFieldsS: 'minimum time per bin (place-field boundaries)',
  minOccS: 'minimum time per bin (spatial tuning)',
  binCm: 'bin size',
  sigmaAuto: 'smoothing',
  sigma: 'smoothing',
  shiftAuto: 'minimum circular shift',
  minShiftS: 'minimum circular shift',
  seed: 'seed',
};

export const AUROC_LABELS: Record<string, string> = {
  compare: 'comparison',
  pairA: 'behavior A',
  pairB: 'behavior B',
  unselected: 'selected behaviors',
  method: 'null method',
  shiftAuto: 'minimum circular shift',
  minShiftS: 'minimum circular shift',
  nShuffles: 'number of shuffles',
  seed: 'seed',
  alpha: 'significance threshold',
  correction: 'correction',
  speedFilter: 'speed filter choice',
  minSpeed: 'minimum speed',
  match: 'speed-matching settings',
};

/** Seconds between two ISO times, or 0 when either is missing. */
export const secondsBetween = (start: string | null, end: string | null) =>
  start && end ? Math.max(0, (Date.parse(end) - Date.parse(start)) / 1000) : 0;
