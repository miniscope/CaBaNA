// Opening and creating projects on disk through the engine: making the project folder, registering
// the data files by path, loading them back into the page (fetched by hash, so a moved file still
// loads), restoring the saved settings, and what to show for a file that cannot be found.
// With the engine off none of this is used and the app works as it does without projects.

import { createEffect, createRoot, createSignal } from 'solid-js';
import { parse } from 'yaml';
import {
  beginAutosave,
  endAutosave,
  saveEverything,
  syncExperimentFile,
  updateAutosaveProject,
} from './autosave.ts';
import { bridgeReady } from './bridge-status.ts';
import { setAppliedNote } from './data-setup-view.ts';
import {
  dataFileOf,
  dataFiles,
  openProject,
  setDataFiles,
  setOpenProject,
} from './open-project.ts';
import { processingFromData, type ProcessingState } from './project-files.ts';
import { applyAnalysis, applyProcessing, captureProcessing } from './project-state.ts';
import {
  chosenPaths,
  projects,
  type DataFile,
  type FileName,
  type ProjectSummary,
} from './projects-client.ts';
import { setSaveStatus } from './save-status.ts';
import { setAllOthers } from './other-types.ts';
import { isOtherId, type OtherId, type SlotId } from './slots.ts';
import { addFiles, clearAll, exampleMedia, goToStep, onClear, setSessionName } from './store.ts';

/** True when the engine can list and save projects. */
export const projectsOn = (): boolean => bridgeReady();

// Until a project is open the indicator reads "Example data · Unsaved" for an example, else
// "Not saved" with the reason that applies.
createRoot(() =>
  createEffect(() => {
    if (openProject()) return;
    setSaveStatus(
      exampleMedia()
        ? { kind: 'example' }
        : bridgeReady()
          ? { kind: 'no-project' }
          : { kind: 'engine-off' },
    );
  }),
);

/** The folder of every project and the projects in it, newest first; undefined until read. */
export const [library, setLibrary] = createSignal<{ root: string; projects: ProjectSummary[] }>();
export const [libraryError, setLibraryError] = createSignal<string>();

export async function refreshLibrary(): Promise<void> {
  try {
    setLibrary(await projects.list());
    setLibraryError(undefined);
  } catch (e) {
    setLibrary(undefined);
    setLibraryError(e instanceof Error ? e.message : String(e));
  }
}

let closing: Promise<unknown> | undefined;
// Clearing the session closes the project in this window; the folder stays on disk.
onClear(() => {
  if (!openProject()) return;
  endAutosave();
  setOpenProject(undefined);
  setDataFiles([]);
  closing = projects.close().catch(() => undefined);
});

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** A file's bytes from the engine, named as it is on disk. */
async function fetchFile(f: Pick<DataFile, 'sha256' | 'name'>): Promise<File> {
  return new File([await projects.fileBytes(f.sha256)], f.name);
}

const readYaml = (text: string): unknown => {
  try {
    return parse(text);
  } catch {
    return undefined;
  }
};
const hasKeys = (v: unknown): boolean => !!v && typeof v === 'object' && Object.keys(v).length > 0;

/**
 * Load an opened project into the page: its data files, then its saved settings. Files that cannot
 * be found stay listed in Data setup with Locate file. The caller has cleared the session.
 */
async function loadProject(project: ProjectSummary, created = false): Promise<void> {
  const [exp, proc, ana, listed] = await Promise.all([
    projects.readFile(project.id, 'experiment.yaml'),
    projects.readFile(project.id, 'processing.yaml'),
    projects.readFile(project.id, 'analysis.yaml'),
    projects.listDataAndLabels(project.id),
  ]);
  const data = listed.files;
  setOpenProject(project);
  setDataFiles(data);
  const experiment = exp.valid ? readYaml(exp.text) : undefined;
  // The project's experiment.yaml is the session config; a config file kept as data is only the
  // starting point of a new project.
  const useExperiment = hasKeys(experiment);
  // Named data types are listed, never read.
  setAllOthers(
    data
      .filter((f) => isOtherId(f.slot))
      .map((f) => ({
        id: f.slot as OtherId,
        name: listed.labels[f.slot] ?? '',
        file: { name: f.name, size: f.size, path: f.path },
      })),
  );
  const usable = data.filter(
    (f) => f.status !== 'missing' && !isOtherId(f.slot) && !(useExperiment && f.slot === 'config'),
  );
  // Each file goes into the data type it was registered for (one file filling two types is
  // fetched once); the config last, so its settings apply with every file in place.
  const fetched = new Map<string, File>();
  const placed: [SlotId, File][] = [];
  for (const f of usable) {
    const key = `${f.sha256}|${f.name}`;
    try {
      if (!fetched.has(key)) fetched.set(key, await fetchFile(f));
      placed.push([f.slot as SlotId, fetched.get(key)!]);
    } catch {
      f.status = 'missing';
    }
  }
  if (useExperiment) placed.push(['config', new File([exp.text], 'config.yaml')]);
  setDataFiles([...data]);
  placed.sort(([a], [b]) => Number(a === 'config') - Number(b === 'config'));
  for (const [slot, file] of placed) await addFiles([file], slot);
  setSessionName(project.name);
  if (proc.valid) applyProcessing(readYaml(proc.text));
  if (ana.valid) applyAnalysis(readYaml(ana.text));
  noteMoved(data);
  // Loading settles through a few effects; the saved copy is taken after them.
  await new Promise((r) => setTimeout(r, 100));
  const times = new Map<string, Date>(
    [exp, proc, ana].map((f) => [f.name, new Date(f.modified)] as const),
  );
  times.set('project.yaml', new Date(project.modified));
  beginAutosave(project, times);
  if (created) await saveEverything('Project created');
  else await syncExperimentFile(experiment);
  goToStep('data');
}

/** One line on Data setup for files found at a new place; the engine saved the new paths. */
function noteMoved(data: DataFile[]): void {
  const moved = data.filter((f) => f.status === 'moved');
  if (moved.length)
    setAppliedNote(
      `${moved.length === 1 ? 'A data file was' : `${moved.length} data files were`} found at a new location and loaded from there: ${moved.map((f) => f.name).join(', ')}.`,
    );
}

/** Open a project from the library (by id) or from a folder or project.yaml (by path). */
export async function openExisting(target: { id: string } | { path: string }): Promise<void> {
  clearAll();
  await closing;
  await loadProject(await projects.open(target));
}

/** One file chosen for a new project, with the data types it fills. */
export interface NewProjectFile {
  path: string;
  slots: SlotId[];
}

/** Make the project folder, register the files by path, open it and load it. */
export async function createFromFiles(
  name: string,
  parent: string | undefined,
  files: NewProjectFile[],
): Promise<void> {
  clearAll();
  await closing;
  const made = await projects.create(name, parent);
  for (const f of files)
    for (const slot of f.slots) await projects.registerData(made.id, slot, f.path);
  await loadProject(await projects.open({ id: made.id }), true);
}

/** Open a .cabana.zip (imported into the projects folder) or a project folder or project.yaml. */
export async function openFromPath(path: string): Promise<void> {
  clearAll();
  await closing;
  const project = /\.zip$/i.test(path)
    ? await projects.importProject(path)
    : await projects.open({ path });
  const opened = /\.zip$/i.test(path) ? await projects.open({ id: project.id }) : project;
  await loadProject(opened);
}

/** Ask for a file with the engine's dialog; the path, or undefined when cancelled. */
export async function chooseFilePath(title: string): Promise<string | undefined> {
  return chosenPaths(await projects.dialog('files', { title }))?.[0];
}

/**
 * Put a chosen file into a data type of the open project: record its path, then load the engine's
 * copy of it. Used by Locate file and Replace file.
 */
export async function useFileForSlot(slot: SlotId, path: string): Promise<void> {
  const project = openProject();
  if (!project) return;
  await projects.registerData(project.id, slot, path);
  const data = await projects.listData(project.id);
  setDataFiles(data);
  const entry = data.find((f) => f.slot === slot);
  await addFiles([entry ? await fetchFile(entry) : new File([], basename(path))], slot);
}

/** Take a data type's file out of the project (the original stays where it is). */
export async function forgetSlot(slot: SlotId): Promise<void> {
  const project = openProject();
  if (!project || !dataFileOf(slot)) return;
  await projects.removeData(project.id, slot).catch(() => undefined);
  setDataFiles(dataFiles().filter((f) => f.slot !== slot));
}

/** The default "Saved to" line, with the home folder written as ~. */
export const tidyPath = (p: string): string => p.replace(/^\/Users\/[^/]+/, '~');

// ---- Other projects as sources, and edits of project.yaml

/** The projects other than the open one, newest first (reads the list again). */
export async function listOtherProjects(): Promise<ProjectSummary[]> {
  await refreshLibrary();
  const open = openProject()?.id;
  return (library()?.projects ?? []).filter((p) => p.id !== open && p.readable);
}

/** A file of another project (or this one), parsed; undefined when it is missing or not valid. */
export async function readProjectYaml(id: string, name: FileName): Promise<unknown> {
  try {
    const f = await projects.readFile(id, name);
    return f.valid ? readYaml(f.text) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The preprocessing settings in another project's processing.yaml (the `preprocess:` section read
 * into the store's own names), for Import preprocessing settings. QC decisions are not returned.
 * Settings the file lacks keep the current values.
 */
export async function readPreprocessOf(
  id: string,
): Promise<Pick<ProcessingState, 'prep' | 'decon'> | undefined> {
  const raw = await readProjectYaml(id, 'processing.yaml');
  if (!raw) return undefined;
  const { prep, decon } = processingFromData(raw, captureProcessing());
  return { prep, decon };
}

/** Change fields of the open project's project.yaml (save mode, retention, copy data). */
export async function updateProjectYaml(
  patch: Partial<Pick<ProjectSummary, 'save_mode' | 'retention' | 'copy_data'>>,
): Promise<void> {
  const project = openProject();
  if (!project) return;
  const file = await projects.readFile(project.id, 'project.yaml');
  const data = { ...(readYaml(file.text) as object), ...patch };
  await projects.writeFile(
    project.id,
    'project.yaml',
    { data },
    `Project setting changed: ${Object.keys(patch).join(', ')}`,
  );
  const now = (await projects.current()) ?? { ...project, ...patch };
  setOpenProject(now);
  updateAutosaveProject(now);
}
