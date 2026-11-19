// Which project window is open: Project settings (and its section), the configuration file viewer,
// and Export portable project. Kept here so the Manage project menu, Results and Data setup can
// open them. The windows are mounted once, in ProjectWindows.tsx.

import { createSignal } from 'solid-js';
import type { RunRecord } from './bridge-client.ts';
import type { FileName } from './projects-client.ts';

export type SettingsSection = 'general' | 'saving' | 'files' | 'storage' | 'history';

export const [projectSettings, setProjectSettings] = createSignal<SettingsSection>();
export const openProjectSettings = (section: SettingsSection = 'general') =>
  setProjectSettings(section);

/** The viewer shows the project's own file, or the copy frozen with a run. */
export interface ViewerTarget {
  name: FileName;
  run?: RunRecord;
  /** Open on the comparison of the file as it is now with this run. */
  compare?: RunRecord;
}
export const [configViewer, setConfigViewer] = createSignal<ViewerTarget>();
export const openConfigFile = (name: FileName, run?: RunRecord) => setConfigViewer({ name, run });
export const openConfigCompare = (name: FileName, compare: RunRecord) =>
  setConfigViewer({ name, compare });

export const [exportOpen, setExportOpen] = createSignal(false);
