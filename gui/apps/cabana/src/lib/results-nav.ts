// Which saved run each analysis page shows. `undefined` means the latest run. Opening an older run
// never touches the current settings; "Load these settings" is a separate action.

import { createSignal } from 'solid-js';
import type { AnalysisId } from './runs.ts';

const [opened, setOpened] = createSignal<Partial<Record<AnalysisId, string>>>({});
export const openedRun = (id: AnalysisId): string | undefined => opened()[id];
export const openRunOf = (id: AnalysisId, runId: string | undefined): void => {
  setOpened({ ...opened(), [id]: runId });
};
