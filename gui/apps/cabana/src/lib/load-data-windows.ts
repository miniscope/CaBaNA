// Which help window of Getting started and Data setup is open. Mounted once (ProjectWindows.tsx),
// so either page can open them.

import { createSignal } from 'solid-js';

/** The Data requirements window, open on one of its tabs. */
export const [requirementsTab, setRequirementsTab] = createSignal<'neural' | 'behavior'>();
/** Organizing your data folder. */
export const [folderHelpOpen, setFolderHelpOpen] = createSignal(false);
/** Analysis overview (from Getting started). */
export const [analysisOverviewOpen, setAnalysisOverviewOpen] = createSignal(false);
