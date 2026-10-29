// Fills the readiness Snapshot from the stores, and keeps it current. The rules themselves are in
// readiness.ts; this file only reads state. Whether a framework run still matches the current
// settings is async (it hashes the input files), so a signal holds the last answer.

import { engineFor } from './engine.ts';
import { createEffect, createMemo, createRoot, createSignal } from 'solid-js';
import { bridgeState } from './bridge-status.ts';
import { decodeTarget } from './decoding-settings.ts';
import { populationSettings } from './population-settings.ts';
import { aurocOutcome, aurocStatus } from './auroc-run.ts';
import { aurocChanges } from './auroc-view.ts';
import { pethOutcome, pethStatus } from './peth-run.ts';
import { pethChanges, pethSettingChanges } from './peth-view.ts';
import { placeOutcome, placeStatus } from './place-run.ts';
import { placeChanges } from './place-ui.ts';
import {
  ANALYSIS_ITEMS,
  featureNeed,
  itemStatus,
  nextStep,
  type AnalysisItem,
  type ItemId,
  type RunState,
  type Snapshot,
  type Status,
} from './readiness.ts';
import { active, blockers, compareToLatest, history, latest, type AnalysisId } from './runs.ts';
import { CARDS, setupSnapshot, statusOf, stimulusLabelIssues } from './setup-status.ts';
import {
  deconvolved,
  denoisedTrace,
  experiment,
  labelRegistry,
  loaded,
  rawTrace,
  samplingRate,
  stepId,
} from './store.ts';
import type { LabelEntry } from './labels.ts';

/** Analyses that always compute through the Python engine. Place cells and auROC depend on the mode (lib/engine.ts); PETH uses the browser. */
export const FRAMEWORK_ENGINE: Record<AnalysisItem, boolean> = {
  place: false,
  auroc: false,
  peth: false,
  decoding: true,
  population: true,
};

/** Counts of usable (not blocked) labels by what analyses can do with them. */
export function labelCounts(registry: LabelEntry[]): Snapshot['labels'] {
  const usable = registry.filter((e) => !e.blocked);
  const zones = usable.filter((e) => e.slot === 'zone_annotations').length;
  const epochs = usable.filter((e) => e.source === 'epochs').length;
  return {
    epochs,
    zones,
    behaviors: usable.filter((e) => e.slot !== 'zone_annotations' && e.source !== 'markers').length,
    alignable: usable.filter((e) => e.source !== 'frame_categorical').length,
  };
}

/** Distinct labels a stimulus names that are not loaded (a stimulus with no label yet is not counted). */
export const missingStimulusLabels = (issues: { label: string }[]): string[] => [
  ...new Set(issues.map((i) => i.label).filter(Boolean)),
];

/** How many states the population page would compare for its current target. */
export function populationStateCount(
  target: 'behaviors' | 'zones' | 'position',
  chosen: string[],
  registry: LabelEntry[],
  hasPosition: boolean,
): number {
  if (target === 'position') return hasPosition ? 2 : 0;
  const usable = registry.filter(
    (e) =>
      !e.blocked &&
      e.source !== 'markers' &&
      (target === 'zones') === (e.slot === 'zone_annotations'),
  );
  const names = new Set(usable.map((e) => e.name));
  return chosen.length ? chosen.filter((n) => names.has(n)).length : names.size;
}

const [visitedPages, setVisitedPages] = createSignal<Partial<Record<ItemId, boolean>>>({});
export const markVisited = (id: ItemId) =>
  visitedPages()[id] || setVisitedPages({ ...visitedPages(), [id]: true });

/** Whether the latest framework run of each analysis still matches the current settings. */
const [matchesLatest, setMatchesLatest] = createSignal<Partial<Record<AnalysisId, boolean>>>({});

/** Safe call for state that may not be complete yet (no data loaded): returns the fallback on error. */
function attempt<T>(f: () => T, fallback: T): T {
  try {
    return f();
  } catch {
    return fallback;
  }
}

const MISSING = /^Missing framework features: (.*)\.$/;

/** Split what `blockers` reports into input problems and the names of missing framework features. */
function frameworkRunState(id: AnalysisId): RunState {
  const a = active();
  const rec = latest[id];
  const running = a?.id === id;
  const messages = attempt(() => blockers(id), [] as string[]).filter(
    (m) => m !== 'Python engine not running.' && m !== 'This analysis is not available.',
  );
  const missing = messages.flatMap((m) => MISSING.exec(m)?.[1].split(', ') ?? []);
  return {
    running,
    progress: running && a.phase === 'running' && a.fraction > 0 ? a.fraction : undefined,
    latest: rec && { status: rec.status, matches: matchesLatest()[id] ?? true },
    issues: messages.filter((m) => !MISSING.test(m)),
    framework: missing.map(featureNeed),
  };
}

/** Browser-engine analyses: a run is running, has results, and matches unless its settings changed. */
function browserRunState(
  status: { kind: string; done?: number; total?: number },
  hasOutcome: boolean,
  changes: () => string[],
): RunState {
  const running = status.kind === 'running';
  const measurable = running && (status.total ?? 0) > 1;
  return {
    running,
    progress: measurable ? (status.done ?? 0) / (status.total as number) : undefined,
    latest:
      status.kind === 'error'
        ? { status: 'failed', matches: false }
        : hasOutcome
          ? { status: 'ok', matches: attempt(changes, []).length === 0 }
          : undefined,
    issues: [],
  };
}

export function buildSnapshot(): Snapshot {
  const reg = labelRegistry();
  const setup = setupSnapshot();
  const position = !!loaded.position?.summary && !loaded.position.error;
  const spatialComplete = statusOf('spatial', setup) === 'Complete';
  const requiredDone = CARDS.filter((c) => c.priority === 'Required').every(
    (c) => (c.id === 'spatial' && !position) || statusOf(c.id, setup) === 'Complete',
  );
  const state = bridgeState();
  const caps: Record<string, boolean> = {};
  if (state.kind === 'ready')
    for (const [k, v] of Object.entries(state.capabilities))
      if (typeof v === 'boolean') caps[k] = v;
  const visited = visitedPages();
  return {
    neural: !!(deconvolved() ?? rawTrace() ?? denoisedTrace()),
    timing: samplingRate() !== undefined,
    deconvolved: !!deconvolved(),
    position,
    spatialComplete,
    labels: labelCounts(reg),
    missingStimulusLabels: missingStimulusLabels(stimulusLabelIssues(setup)),
    bridge: state.kind,
    capabilities: caps,
    frameworkEngine: {
      ...FRAMEWORK_ENGINE,
      place: engineFor('place') === 'framework',
      auroc: engineFor('auroc') === 'framework',
    },
    populationStates: populationStateCount(
      populationSettings.target,
      [...populationSettings.labels],
      reg,
      position,
    ),
    decodingTarget: decodeTarget.type,
    runs: {
      place: browserRunState(placeStatus(), !!placeOutcome(), placeChanges),
      auroc: browserRunState(aurocStatus(), !!aurocOutcome(), aurocChanges),
      peth: browserRunState(pethStatus(), !!pethOutcome(), () => [
        ...pethChanges(),
        ...pethSettingChanges(),
      ]),
      decoding: frameworkRunState('decoding'),
      population: frameworkRunState('population'),
    },
    visited,
    // Without a position file no setup card is required, so the page only has to have been opened.
    setupComplete: position ? requiredDone : !!visited.setup && requiredDone,
    hasRuns: history().length > 0 || !!(placeOutcome() ?? aurocOutcome() ?? pethOutcome()),
  };
}

/** The live snapshot, and a refresher for the async "matches the current settings" answers. */
export const snapshot = createRoot(() => {
  let sequence = 0;
  // Re-hash whenever anything the settings hash reads changes; ignore answers that arrive late.
  createEffect(() => {
    const ids = (['decoding', 'population'] as AnalysisId[]).filter((id) => latest[id]);
    const mine = ++sequence;
    void Promise.all(
      ids.map((id) =>
        compareToLatest(id)
          .then((r) => [id, r?.matches ?? true] as const)
          .catch(() => [id, true] as const),
      ),
    ).then((rows) => {
      if (mine === sequence) setMatchesLatest(Object.fromEntries(rows));
    });
  });
  return createMemo(buildSnapshot);
});

const statusMemos = createRoot(() => {
  const per = {} as Record<ItemId, () => Status>;
  const ids: ItemId[] = ['load', 'setup', 'viz', 'qc', 'prep', ...ANALYSIS_ITEMS, 'results'];
  for (const id of ids) per[id] = createMemo(() => itemStatus(snapshot(), id));
  return per;
});
/** Reactive status of one sidebar item. */
export const statusOfItem = (id: ItemId): Status => statusMemos[id]();

/** The sidebar item the current page belongs to (the Analyze overview counts as just before the analyses). */
export function currentItem(step: string, analysis: AnalysisItem): ItemId {
  if (step === 'analyze') return analysis;
  if (step === 'analyze_overview') return 'prep';
  return ORDERED.includes(step as ItemId) ? (step as ItemId) : 'load';
}
const ORDERED: ItemId[] = ['load', 'setup', 'viz', 'qc', 'prep', 'results'];

export const nextFor = (current: ItemId) => nextStep(snapshot(), current, experiment().recommended);

/** Records the visit of the open page, for "Viewed" on the optional pages. */
export function trackVisits(): void {
  createEffect(() => {
    const step = stepId() as ItemId;
    if (ORDERED.includes(step)) markVisited(step);
  });
}
