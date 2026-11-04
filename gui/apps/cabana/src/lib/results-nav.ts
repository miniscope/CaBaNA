// Which saved run each analysis page shows. `undefined` means the latest run. Opening an older run
// never touches the current settings; "Load these settings" is a separate action.

import { createSignal, untrack } from 'solid-js';
import type { AnalysisId } from './runs.ts';

const [opened, setOpened] = createSignal<Partial<Record<AnalysisId, string>>>({});
export const openedRun = (id: AnalysisId): string | undefined => opened()[id];
export const openRunOf = (id: AnalysisId, runId: string | undefined): void => {
  setOpened({ ...opened(), [id]: runId });
};

// The Results Explorer in view: which analysis, and which saved run (the latest when absent).
export interface ExplorerTarget {
  analysis: AnalysisId;
  runId?: string;
}
const [explorer, setExplorer] = createSignal<ExplorerTarget | undefined>();
export const explorerTarget = explorer;
export const openExplorer = (analysis: AnalysisId, runId?: string): void => {
  setPlotRequest(undefined);
  setExplorer({ analysis, runId });
};
export const closeExplorer = (): void => setExplorer(undefined);

// A plot the Explorer asks an analysis page to open. The page reads it once with
// `takePlotRequest` (any view name it knows) and the request is cleared.
const [plotRequest, setPlotRequest] = createSignal<
  { analysis: AnalysisId; view: string } | undefined
>();
export const requestPlot = (analysis: AnalysisId, view: string): void => {
  setPlotRequest({ analysis, view });
};
export function takePlotRequest(
  analysis: AnalysisId,
  known: readonly string[],
): string | undefined {
  const req = plotRequest();
  if (req?.analysis !== analysis || !known.includes(req.view)) return undefined;
  untrack(() => setPlotRequest(undefined));
  return req.view;
}
