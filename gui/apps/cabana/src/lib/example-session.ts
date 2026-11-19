// Example data is a project that has not been saved yet. This file tells what has been done to it
// since it was loaded (the counts shown in Save as project and in the discard warning), and asks
// before work on an example is thrown away.

import { createSignal } from 'solid-js';
import { history as changeLog } from './changes-log.ts';
import { confirmAction } from './confirm.ts';
import { openProject } from './open-project.ts';
import { describeAnalysis, type AnalysisSections, type ProcessingState } from './project-files.ts';
import { captureAnalysis, captureProcessing } from './project-state.ts';
import { hashOf, history as runHistory } from './runs.ts';
import { SLOTS } from './slots.ts';
import {
  exampleMedia,
  loadFetchedExample,
  onClear,
  slotFile,
  type FetchedExample,
} from './store.ts';

/** An example is loaded and no project is open. */
export const isExample = (): boolean => !!exampleMedia() && !openProject();

export interface ExampleChanges {
  /** Rejected cells, position jumps left out or kept, annotation fixes. */
  corrections: number;
  /** Preprocessing settings, deconvolution check and QC limits that differ from the loaded state. */
  prep: number;
  /** Analyses whose settings differ. */
  analysis: number;
  /** Finished runs made with this example. */
  runs: number;
  /** Entries of the correction and preprocessing log. */
  log: number;
}

const symmetricDifference = <T>(a: T[], b: T[]): number =>
  a.filter((x) => !b.includes(x)).length + b.filter((x) => !a.includes(x)).length;

const differs = (a: unknown, b: unknown): number =>
  JSON.stringify(a) === JSON.stringify(b) ? 0 : 1;

/** QC corrections and preprocessing changes between two processing states. */
export function countProcessing(
  before: ProcessingState,
  after: ProcessingState,
): Pick<ExampleChanges, 'corrections' | 'prep'> {
  const prep = (Object.keys(after.prep) as (keyof ProcessingState['prep'])[]).filter(
    (k) => before.prep[k] !== after.prep[k],
  ).length;
  return {
    corrections:
      symmetricDifference(before.rejectedCells, after.rejectedCells) +
      symmetricDifference(before.excludeFrames, after.excludeFrames) +
      symmetricDifference(before.keptFrames, after.keptFrames) +
      differs(before.annotationFixes.merge, after.annotationFixes.merge) +
      differs(before.annotationFixes.drop, after.annotationFixes.drop),
    prep: prep + differs(before.decon, after.decon) + differs(before.limits, after.limits),
  };
}

export const countAnalysis = (before: AnalysisSections, after: AnalysisSections): number =>
  describeAnalysis(before, after).length;

/** "1 QC correction, 1 preprocessing change and 2 analysis runs"; empty when nothing changed. */
export function workText(c: ExampleChanges): string {
  const n = (count: number, one: string, many = `${one}s`) =>
    count ? [`${count} ${count === 1 ? one : many}`] : [];
  const parts = [
    ...n(c.corrections, 'QC correction'),
    ...n(c.prep, 'preprocessing change'),
    ...n(c.analysis, 'analysis settings change', 'analysis settings changes'),
    ...n(c.runs, 'analysis run'),
  ];
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

interface Loaded {
  processing: ProcessingState;
  analysis: AnalysisSections;
  /** Hashes of the files, to tell this example's runs from others made with no project open. */
  hashes: Set<string>;
  at: number;
}
const [loaded, setLoaded] = createSignal<Loaded>();
onClear(() => setLoaded(undefined));

/** Load an example as the session and note its state, so later changes can be counted. */
export async function startExample(id: string, got: FetchedExample): Promise<void> {
  await loadFetchedExample(id, got);
  // Loading settles through a few effects (a config's settings apply after the files).
  await new Promise((r) => setTimeout(r, 100));
  const files = SLOTS.flatMap((s) => slotFile(s.id) ?? []);
  const hashes = new Set(await Promise.all(files.map(hashOf)));
  setLoaded({
    processing: captureProcessing(),
    analysis: captureAnalysis(),
    hashes,
    at: Date.now(),
  });
}

const FINISHED = new Set(['ok', 'partial', 'failed', 'cancelled']);

/** The finished runs of the example session: made with its files, since it was loaded. */
export function exampleRuns() {
  const start = loaded();
  if (!start) return [];
  return runHistory().filter(
    (r) =>
      FINISHED.has(r.status) &&
      r.session.inputs.length > 0 &&
      r.session.inputs.every((i) => start.hashes.has(i.sha256)) &&
      Date.parse(r.created_utc) >= start.at - 1000,
  );
}

export function exampleChanges(): ExampleChanges {
  const start = loaded();
  const empty = { corrections: 0, prep: 0, analysis: 0, runs: 0, log: changeLog().length };
  if (!start) return empty;
  return {
    ...empty,
    ...countProcessing(start.processing, captureProcessing()),
    analysis: countAnalysis(start.analysis, captureAnalysis()),
    runs: exampleRuns().length,
  };
}

/** Whether an example is open with work that a discard would lose. */
export function hasExampleWork(): boolean {
  if (!isExample()) return false;
  const c = exampleChanges();
  return c.corrections + c.prep + c.analysis + c.runs > 0;
}

/** The Save as project window; `after` runs once the project is saved. */
export const [saveDialog, setSaveDialog] = createSignal<{ after?: () => void }>();

/**
 * Run `next`, which would replace or close the session, after asking when an example with work is
 * open. Every such action goes through here.
 */
export function guardExample(next: () => void): void {
  if (!hasExampleWork()) return next();
  confirmAction({
    title: 'Discard the example session?',
    message: `This example has unsaved work: ${workText(exampleChanges())}. Discarding removes it. Save as project keeps it.`,
    confirmLabel: 'Discard',
    alternative: { label: 'Save as project…', onSelect: () => setSaveDialog({ after: next }) },
    onConfirm: next,
  });
}

if (typeof window !== 'undefined')
  window.addEventListener('beforeunload', (e) => {
    if (hasExampleWork()) e.preventDefault();
  });
