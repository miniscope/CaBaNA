// Which data type each picked file goes to. addFiles (store.ts) loads by this and the New Project
// list shows it, so the preview cannot disagree with what loads.

import { readConfig, isSessionConfig } from './config-read.ts';
import { matchSlot, type SlotId } from './slots.ts';

export interface Placement {
  file: File;
  /** The data types the file fills; empty when it matches none. */
  slots: SlotId[];
}

const isYaml = (f: File) => /\.ya?ml$/i.test(f.name);

/**
 * The session config among `files`, recognized by its content (a framework session layout), not
 * by its name. With several, the one named like a config wins.
 */
export async function findConfig(files: File[]): Promise<File | undefined> {
  const configs: File[] = [];
  for (const f of files.filter(isYaml)) if (isSessionConfig(await f.text())) configs.push(f);
  return configs.find((f) => matchSlot(f.name) === 'config') ?? configs[0];
}

/**
 * Where each file goes. The config's own file names (`named`) decide first, then the file name.
 * A frame-label file that another slot claims fills both slots: the framework reads frame labels
 * from the same file. With `slot`, every file goes there.
 */
export function placeFiles(
  files: File[],
  config: File | undefined,
  named: Partial<Record<SlotId, string>>,
  slot?: SlotId,
): Placement[] {
  const byName = new Map(Object.entries(named).map(([id, n]) => [n, id as SlotId]));
  return files.map((file) => {
    if (file === config) return { file, slots: ['config'] };
    // Other YAML files are not data; they wait unmatched, where the user can still assign one.
    const id = slot ?? byName.get(file.name) ?? (isYaml(file) ? undefined : matchSlot(file.name));
    if (!id) return { file, slots: [] };
    const alsoLabels = !slot && id !== 'frame_labels' && matchSlot(file.name) === 'frame_labels';
    return { file, slots: alsoLabels ? [id, 'frame_labels'] : [id] };
  });
}

/** The placements a load of `files` would make, without loading anything. */
export async function previewPlacements(files: File[]): Promise<Placement[]> {
  const config = await findConfig(files);
  const named = config ? readConfig(await config.text()).files : {};
  return placeFiles(files, config, named);
}
