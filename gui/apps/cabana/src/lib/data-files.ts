// Adding data on Data setup: a folder, a file for one row, a file for a named data type, and the
// files of the Unassigned card. With the engine on, files are chosen in the engine's dialog by
// path, and the first one makes a draft project (project-session.ts); without the engine, or for
// example data, the browser reads them.

import { createSignal } from 'solid-js';
import { openProject, setDataFiles } from './open-project.ts';
import { identify } from './other-files.ts';
import { addOther, others, setOtherFile, type OtherType } from './other-types.ts';
import { pickFile } from './pick-file.ts';
import {
  addPathToProject,
  chooseFilePath,
  createDraft,
  projectsOn,
  type DraftFile,
} from './project-session.ts';
import { chosenPaths, projects, type ScannedFile } from './projects-client.ts';
import { placeFiles } from './file-match.ts';
import { isVideo, matchSlot, slotOf, type OtherId, type SlotId } from './slots.ts';
import {
  addFiles,
  addIgnored,
  addUnassigned,
  clearFolderLists,
  dropUnassigned,
  exampleMedia,
  setFolderInfo,
  type UnassignedFile,
} from './store.ts';

/** Files are chosen by path (engine dialogs) only with the engine on and no example loaded. */
export const byPath = (): boolean => projectsOn() && !(exampleMedia() && !openProject());

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** What is being read now ("Reading m42_day3…"), shown in the folder box; undefined when idle. */
export const [adding, setAdding] = createSignal<string>();
async function reading<T>(what: string, f: () => Promise<T>): Promise<T> {
  setAdding(`Reading ${what}…`);
  try {
    return await f();
  } finally {
    setAdding(undefined);
  }
}

/**
 * Sort a scanned folder: each data type takes the first file that matches it by name; a second
 * match, an unknown file or a YAML file that is not the experiment details waits as unassigned;
 * hidden files are skipped and videos ignored.
 */
export function sortScanned(files: ScannedFile[]): {
  matched: DraftFile[];
  unassigned: ScannedFile[];
  ignored: string[];
} {
  const matched: DraftFile[] = [];
  const unassigned: ScannedFile[] = [];
  const ignored: string[] = [];
  const taken = new Set<string>();
  for (const f of files) {
    if (f.name.startsWith('.')) continue;
    if (isVideo(f.name)) {
      ignored.push(f.name);
      continue;
    }
    const slots: SlotId[] = /\.ya?ml$/i.test(f.name)
      ? matchSlot(f.name) === 'config'
        ? ['config']
        : []
      : placeFiles([f], undefined, {})[0].slots;
    const free = slots.filter((s) => !taken.has(s));
    if (!free.length || free.length < slots.length) {
      unassigned.push(f);
      continue;
    }
    for (const slot of free) {
      taken.add(slot);
      matched.push({ path: f.path, slot });
    }
  }
  return { matched, unassigned, ignored };
}

/** Select folder with the engine: its files fill the data types, the rest wait in Unassigned. */
export async function addFolderByPath(): Promise<void> {
  const paths = chosenPaths(
    await projects.dialog('folder', { title: 'Select the folder with your data' }),
  );
  if (!paths) return;
  await reading(basename(paths[0]), () => addScanned(paths));
}

async function addScanned(paths: string[]): Promise<void> {
  const { files } = await projects.scan(paths);
  const sorted = sortScanned(files);
  if (openProject())
    for (const f of sorted.matched) await addPathToProject(f.slot as SlotId, f.path);
  else await createDraft(sorted.matched);
  clearFolderLists();
  addUnassigned(
    sorted.unassigned.map((f) => ({ key: f.path, name: f.name, size: f.size, path: f.path })),
  );
  addIgnored(sorted.ignored);
  setFolderInfo({
    name: basename(paths[0]),
    total: files.length,
    identified: new Set(sorted.matched.map((f) => f.path)).size,
    unassigned: sorted.unassigned.length,
    ignored: sorted.ignored.length,
  });
}

/** Select file on a row: the engine's dialog, or the browser's chooser limited to its types. */
export async function selectFileFor(slot: SlotId): Promise<void> {
  if (!byPath()) return pickFile((f) => void addFiles([f], slot), slotOf(slot).accept);
  const path = await chooseFilePath(`Select the ${slotOf(slot).label.toLowerCase()} file`);
  if (path) await reading(basename(path), () => addPathToProject(slot, path));
}

/** Register a named data type's file in the project (making the draft if there is none). */
async function registerOther(o: Pick<OtherType, 'id' | 'name'>, path: string): Promise<void> {
  if (!openProject()) await createDraft([]);
  const project = openProject()!;
  const entry = await projects.registerData(project.id, o.id, path, o.name);
  setDataFiles(await projects.listData(project.id));
  setOtherFile(o.id, { name: basename(path), size: entry.size, path });
}

/** Select file for a named data type. Its contents are never read. */
export async function selectFileForOther(id: OtherId): Promise<void> {
  const o = others.find((x) => x.id === id);
  if (!o) return;
  if (!byPath()) return pickFile((f) => setOtherFile(id, { name: f.name, size: f.size }));
  const path = await chooseFilePath('Select the file for this data type');
  if (path) await registerOther(o, path);
}

/** Keep a named data type's new name in the project, when it has a file there. */
export async function saveOtherName(id: OtherId): Promise<void> {
  const o = others.find((x) => x.id === id);
  if (o?.file?.path && openProject()) await registerOther(o, o.file.path);
}

/** Assign an unassigned file to a data type, to a new named type, or as the experiment details. */
export async function assignTo(u: UnassignedFile, target: SlotId | 'other'): Promise<void> {
  if (target === 'other') {
    const id = addOther(u.name.replace(/\.[^.]+$/, ''));
    dropUnassigned(u.key);
    if (u.path) await registerOther({ id, name: others.find((o) => o.id === id)!.name }, u.path);
    else setOtherFile(id, { name: u.name, size: u.size });
    return;
  }
  if (u.path) {
    await addPathToProject(target, u.path);
    dropUnassigned(u.key);
  } else if (u.file && target === 'config') {
    dropUnassigned(u.key);
    await addFiles([u.file], 'config');
  } else if (u.file) await identify(u.file, target);
}
