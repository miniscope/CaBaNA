// Project state kept beside the runs (plan P5): only what the GUI alone knows. Inputs are not
// stored here; they live in the bridge's input store and are restored from there by hash.

import { bridge } from './bridge-client.ts';
import { SETTINGS_VERSION } from './settings-hash.ts';

export const PROJECT_VERSION = 1;

export interface ProjectState {
  projectVersion: number;
  settingsVersion: number;
  /** Arena drawing, QC answers and other stores, each as the plain object its owner reads back. */
  arena?: unknown;
  rejectedCells: number[];
  labelRoles: Record<string, 'measured' | 'controlled'>;
  frameColumnRoles: Record<string, string>;
  prep: Record<string, unknown>;
  view: Record<string, unknown>;
  /** Config path -> sha256 of each loaded input, so a reopened project can restore the files. */
  inputs: Record<string, string>;
  sessionId?: string;
  savedUtc: string;
}

export const emptyProject = (): ProjectState => ({
  projectVersion: PROJECT_VERSION,
  settingsVersion: SETTINGS_VERSION,
  rejectedCells: [],
  labelRoles: {},
  frameColumnRoles: {},
  prep: {},
  view: {},
  inputs: {},
  savedUtc: new Date(0).toISOString(),
});

export class ProjectTooNew extends Error {}

/** Missing fields take defaults; a project saved by a newer GUI is refused, not half read. */
export function readProject(raw: unknown): ProjectState {
  const saved = (raw ?? {}) as Partial<ProjectState>;
  if (
    (saved.projectVersion ?? 1) > PROJECT_VERSION ||
    (saved.settingsVersion ?? 1) > SETTINGS_VERSION
  )
    throw new ProjectTooNew('Saved by a newer GUI. Update to open this project.');
  return { ...emptyProject(), ...saved };
}

export const saveProject = (state: ProjectState) =>
  bridge.putProject({ ...state, savedUtc: new Date().toISOString() });

export async function loadProject(): Promise<ProjectState> {
  return readProject(await bridge.getProject());
}

/** Fetch the stored input files of a session as File objects, named as they were uploaded. */
export async function restoreInputs(
  sessionId: string,
  inputs: Record<string, string>,
): Promise<Record<string, File>> {
  const out: Record<string, File> = {};
  for (const [key, sha] of Object.entries(inputs)) {
    const { bytes, name } = await bridge.sessionFile(sessionId, sha);
    out[key] = new File([bytes], name);
  }
  return out;
}
