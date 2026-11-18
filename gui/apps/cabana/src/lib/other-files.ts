// Files no data type matched, listed on the Data setup page until the user says what each one is.
// Choosing a type runs a format check: a valid file moves into its data type's card, a file that
// does not fit stays here with the reason, and a supplementary file stays listed as not used.

import { createStore } from 'solid-js/store';
import { checkFormat, readFileInfo, type FileInfo } from './file-format.ts';
import { SLOTS, type SlotId } from './slots.ts';
import { assignFile } from './store.ts';

export type Choice = SlotId | 'supplementary';

export interface Identified {
  choice: Choice;
  /** Why the file does not fit the chosen type. */
  reason?: string;
}

/** The types offered, grouped as on the page; the config is set in Experimental setup instead. */
export const NEURAL_CHOICES: SlotId[] = [
  'neural_timestamps',
  'neural_raw',
  'neural_denoised',
  'neural_deconvolved',
  'footprints',
];
export const BEHAVIOR_CHOICES: SlotId[] = [
  'behavior_timestamps',
  'behavior_annotations',
  'zone_annotations',
  'time_markers',
  'frame_labels',
  'position',
  'head_orientation',
];

export const slotName = (id: SlotId) => SLOTS.find((s) => s.id === id)!.label;

const keyOf = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
const [chosen, setChosen] = createStore<Record<string, Identified | undefined>>({});
const [infos, setInfos] = createStore<Record<string, FileInfo | undefined>>({});

export const identifiedAs = (f: File): Identified | undefined => chosen[keyOf(f)];
export const infoOf = (f: File): FileInfo | undefined => infos[keyOf(f)];

/** Read the file's head once, for the list line. */
export async function describe(f: File): Promise<void> {
  if (infos[keyOf(f)]) return;
  setInfos(keyOf(f), await readFileInfo(f));
}

/** Apply the user's choice of type for a file. */
export async function identify(f: File, choice: Choice): Promise<void> {
  const key = keyOf(f);
  if (choice === 'supplementary') return void setChosen(key, { choice });
  await describe(f);
  const check = checkFormat(choice, infos[key]!, slotName(choice));
  if (!check.ok) return void setChosen(key, { choice, reason: check.reason });
  setChosen(key, undefined);
  await assignFile(f, choice);
}
