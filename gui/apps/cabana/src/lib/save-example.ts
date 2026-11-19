// Save as project for example data: make the project folder, copy the example's files into it,
// move the runs made so far into it, then open it in place so everything done so far (QC
// corrections, preprocessing, analysis settings, the open page) stays as it is.

import { bridge } from './bridge-client.ts';
import { beginAutosave, saveEverything } from './autosave.ts';
import { exampleRuns } from './example-session.ts';
import { setDataFiles, setOpenProject } from './open-project.ts';
import { projects } from './projects-client.ts';
import { refreshHistory } from './runs.ts';
import { SLOTS, type SlotId } from './slots.ts';
import { setSessionName, slotFile } from './store.ts';

/** The example's files by data type; one file filling two types is listed under each. */
export const exampleFiles = (): { slot: SlotId; file: File }[] =>
  SLOTS.flatMap((s) => {
    const file = slotFile(s.id);
    return file ? [{ slot: s.id, file }] : [];
  });

/** How many files are copied into the project and their total size in bytes. */
export function copySize(): { count: number; bytes: number } {
  const unique = new Set(exampleFiles().map((f) => f.file));
  return { count: unique.size, bytes: [...unique].reduce((n, f) => n + f.size, 0) };
}

/**
 * Save the example as a project named `name` in `parent` (the projects folder when undefined).
 * `progress` gets a line for each stage. On an error the example session is untouched and the
 * half-made project folder is moved to the Trash.
 */
export async function saveExampleAsProject(
  name: string,
  parent: string | undefined,
  progress: (line: string) => void,
): Promise<void> {
  const files = exampleFiles();
  let id: string | undefined;
  let runsMoved = false;
  try {
    progress('Creating the project folder…');
    id = (await projects.create(name, parent)).id;
    const hashes = new Map<File, string>();
    for (const [i, { slot, file }] of files.entries()) {
      progress(`Copying ${file.name} (${i + 1} of ${files.length})…`);
      if (!hashes.has(file)) hashes.set(file, await bridge.upload(file));
      await projects.dataFromInput(id, slot, hashes.get(file)!, file.name);
    }
    // Runs made with no project open move in before the project opens; the engine refuses the
    // open while one is still active.
    await refreshHistory();
    const runIds = exampleRuns().map((r) => r.run_id);
    if (runIds.length) {
      progress(`Moving ${runIds.length} run${runIds.length === 1 ? '' : 's'} into the project…`);
      runsMoved = true;
      await projects.adoptRuns(id, runIds);
    }
    progress('Opening the project…');
    const project = await projects.open({ id });
    setOpenProject(project);
    setDataFiles(await projects.listData(project.id));
    setSessionName(project.name);
    beginAutosave(project, new Map([['project.yaml', new Date(project.modified)]]));
    await saveEverything('Saved from example data');
    await refreshHistory();
  } catch (e) {
    if (id && !runsMoved) await projects.remove(id).catch(() => undefined);
    throw e;
  }
}
