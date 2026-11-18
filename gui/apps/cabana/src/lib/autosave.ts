// Writes the project's configuration files while it is open: about a second after a change stops,
// each changed file goes to the engine with a line for the change history. It watches the stores,
// so it works the same whether a setting applies at once or when a pop-up commits its draft.
// With manual saving the same changes wait for Save project.

import { createEffect, createRoot, untrack } from 'solid-js';
import { BridgeError } from './bridge-client.ts';
import { openProject } from './open-project.ts';
import {
  analysisToData,
  ANALYSIS_HEADER,
  describeAnalysis,
  describeExperiment,
  describeProcessing,
  joinSummary,
  PROCESSING_HEADER,
  processingToData,
  yamlText,
  type AnalysisSections,
  type ProcessingState,
} from './project-files.ts';
import { captureAnalysis, captureProcessing } from './project-state.ts';
import { CONFIG_FILES, projects, type ProjectSummary } from './projects-client.ts';
import { setSaveStatus, type SavedFile } from './save-status.ts';
import { experimentConfig, experimentYaml } from './session-config.ts';

type Obj = Record<string, unknown>;
interface Snapshot {
  experiment: Obj;
  processing: ProcessingState;
  analysis: AnalysisSections;
}
type Written = 'experiment.yaml' | 'processing.yaml' | 'analysis.yaml';
const WRITTEN: Written[] = ['experiment.yaml', 'processing.yaml', 'analysis.yaml'];
const DELAY_MS = 1000;
const RETRY_MS = 5000;

const snapshot = (): Snapshot => ({
  experiment: experimentConfig(),
  processing: captureProcessing(),
  analysis: captureAnalysis(),
});
const dataOf = (s: Snapshot, f: Written): Obj =>
  f === 'experiment.yaml'
    ? s.experiment
    : f === 'processing.yaml'
      ? processingToData(s.processing)
      : analysisToData(s.analysis);
const keyOf = (s: Snapshot, f: Written) => JSON.stringify(dataOf(s, f));

function textOf(s: Snapshot, f: Written): string {
  if (f === 'experiment.yaml') return experimentYaml(s.experiment);
  return yamlText(dataOf(s, f), f === 'processing.yaml' ? PROCESSING_HEADER : ANALYSIS_HEADER);
}

/** The history line for a change to `file`, in words. */
function summaryOf(before: Snapshot, after: Snapshot, f: Written): string {
  const lines =
    f === 'experiment.yaml'
      ? describeExperiment(before.experiment, after.experiment)
      : f === 'processing.yaml'
        ? describeProcessing(before.processing, after.processing)
        : describeAnalysis(before.analysis, after.analysis);
  return lines.length ? joinSummary(lines) : `${f} changed`;
}

let session: { project: ProjectSummary; saved: Snapshot; times: Map<string, Date> } | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let writing: Promise<void> | undefined;

const savedFiles = (): SavedFile[] =>
  CONFIG_FILES.flatMap((name) => {
    const at = session?.times.get(name);
    return at ? [{ name, at }] : [];
  });
const isManual = () => session?.project.save_mode === 'manual';

/** Whether the current state differs from what is on disk. */
const dirty = (snap = untrack(snapshot)) =>
  !!session && WRITTEN.some((f) => keyOf(snap, f) !== keyOf(session!.saved, f));

function showSaved(): void {
  if (!session) return;
  setSaveStatus({ kind: 'saved', at: new Date(), dir: session.project.path, files: savedFiles() });
}

async function write(force: boolean, summary?: string): Promise<void> {
  const s = session;
  if (!s) return;
  const snap = untrack(snapshot);
  const changed = WRITTEN.filter((f) => force || keyOf(snap, f) !== keyOf(s.saved, f));
  if (!changed.length) return showSaved();
  setSaveStatus({ kind: 'saving' });
  try {
    for (const f of changed) {
      const { saved_at } = await projects.writeFile(
        s.project.id,
        f,
        { text: textOf(snap, f) },
        summary ?? summaryOf(s.saved, snap, f),
      );
      s.times.set(f, new Date(saved_at));
      // Only this file's part of the saved copy moves, so a failed later file is tried again.
      s.saved = { ...s.saved, ...part(snap, f) };
    }
    if (session === s) showSaved();
  } catch (e) {
    if (session !== s) return;
    setSaveStatus(
      e instanceof BridgeError && e.status !== 0
        ? { kind: 'error', message: e.message }
        : { kind: 'engine-off' },
    );
    schedule(RETRY_MS);
  }
}

const part = (s: Snapshot, f: Written): Partial<Snapshot> =>
  f === 'experiment.yaml'
    ? { experiment: s.experiment }
    : f === 'processing.yaml'
      ? { processing: s.processing }
      : { analysis: s.analysis };

/** Write what changed now (waits for a write already running). Used by Save project and before runs. */
export async function saveNow(): Promise<void> {
  clearTimeout(timer);
  await writing;
  writing = write(false).finally(() => (writing = undefined));
  await writing;
}

function schedule(ms: number): void {
  clearTimeout(timer);
  timer = setTimeout(() => void saveNow(), ms);
}

/** Whether the project has changes not yet on disk (manual saving). */
export const hasUnsaved = (): boolean => dirty();

/** Write all three files as they are now (a new project). */
export async function saveEverything(summary: string): Promise<void> {
  await writing;
  writing = write(true, summary).finally(() => (writing = undefined));
  await writing;
}

// Started with the first project, not at import: the stores it reads come from modules that import
// this one (through runs.ts), and are not ready yet at that point.
let watching = false;
function watchStores(): void {
  if (watching) return;
  watching = true;
  createRoot(() => {
    createEffect(() => {
      const snap = snapshot(); // read here so the effect follows every store the files depend on
      untrack(() => {
        if (!session || openProject()?.id !== session.project.id) return;
        if (!dirty(snap)) return;
        if (isManual()) setSaveStatus({ kind: 'unsaved' });
        else schedule(DELAY_MS);
      });
    });
  });
}

/**
 * Start watching for `project`, taking the current state as what is saved. Call when the project's
 * files are loaded and its saved settings are applied. `times` are the files' last-write times.
 */
export function beginAutosave(project: ProjectSummary, times: Map<string, Date>): void {
  watchStores();
  clearTimeout(timer);
  session = { project, saved: untrack(snapshot), times };
  showSaved();
}

/** The open project was renamed or its settings changed: keep what the indicator shows current. */
export function updateAutosaveProject(project: ProjectSummary): void {
  if (!session) return;
  session.project = project;
  if (!dirty()) showSaved();
}

/** Stop watching (the project was closed or another one opened). */
export function endAutosave(): void {
  clearTimeout(timer);
  session = undefined;
}

/** Manual saving: the project's mode was changed in Project settings. */
export function setSaveMode(mode: ProjectSummary['save_mode']): void {
  if (!session) return;
  session.project = { ...session.project, save_mode: mode };
  if (!dirty()) showSaved();
  else if (mode === 'manual') setSaveStatus({ kind: 'unsaved' });
  else schedule(DELAY_MS);
}

if (typeof window !== 'undefined')
  window.addEventListener('beforeunload', (e) => {
    if (session && (isManual() ? dirty() : false)) e.preventDefault();
  });
