// The entries of the Plot type drop-down for one run: the window's own views first, then the plots
// of the analysis's page, drawn inside the window when the run allows it and listed disabled, with
// the reason, when not.

import { createMemo, createSignal, type Accessor } from 'solid-js';
import type { RunRecord } from '../../lib/bridge-client.ts';
import type { ExplorerData } from '../../lib/explorer-data.ts';
import { browserOutcomeInMemory } from '../../lib/live-outcome.ts';
import { plotsAvailable, type PlotEntry } from '../../lib/results-explorer.ts';
import { hasResults } from '../../lib/results-overview.ts';
import { pagePlotLabel, pagePlots } from '../../lib/results-window.ts';
import type { AnalysisId } from '../../lib/runs.ts';
import type { ExplorerParts, PlotType } from './explorer-parts.ts';

export interface PlotChoice {
  id: string;
  label: string;
  /** A view the window draws itself. */
  view?: PlotType;
  /** A plot of the analysis's page, embedded. */
  page?: PlotEntry;
  /** Why it cannot be drawn for this run. */
  disabled?: string;
}

export function createPlotChoice(
  record: Accessor<RunRecord | undefined>,
  parts: Accessor<ExplorerParts | undefined>,
  data: Accessor<ExplorerData | undefined>,
  records: Accessor<RunRecord[]>,
) {
  const [picked, setPicked] = createSignal<string>();
  const choices = createMemo((): PlotChoice[] => {
    const r = record();
    if (!r) return [];
    const views: PlotChoice[] = (parts()?.plots ?? []).map((v) => ({
      id: v.id,
      label: v.label,
      view: v,
    }));
    const newest = records().find(
      (x) => x.analysis === r.analysis && x.engine === 'browser-ts' && hasResults(x),
    );
    const state = plotsAvailable(r, {
      inMemory: browserOutcomeInMemory(r.analysis as AnalysisId),
      newestRunId: newest?.run_id,
    });
    const taken = views.map((v) => v.label);
    const extras = pagePlots(r.analysis as AnalysisId, data(), r, !!parts()?.coversPlots).map(
      (p): PlotChoice => ({
        id: `page:${p.id}`,
        label: pagePlotLabel(p.title, taken),
        page: p,
        disabled: state.ok ? undefined : state.reason,
      }),
    );
    return [...views, ...extras];
  });
  /** The chosen entry, else the first one that can be drawn. */
  const current = createMemo(
    () =>
      choices().find((c) => c.id === picked() && !c.disabled) ?? choices().find((c) => !c.disabled),
  );
  return { choices, current, pick: setPicked };
}
