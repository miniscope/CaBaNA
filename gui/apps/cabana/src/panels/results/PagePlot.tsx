// A plot of an analysis's own page, drawn inside the Results window: the page's results component
// on the outcome of this run, opened on that plot. A framework run's outcome is rebuilt from its
// saved results; a browser-engine run's is the one still in memory (see plotsAvailable).

import { createResource, onCleanup, Show, type JSX } from 'solid-js';
import { aurocOutcome, aurocOutcomeFromRun } from '../../lib/auroc-run.ts';
import type { RunRecord } from '../../lib/bridge-client.ts';
import { browserRun } from '../../lib/decoding-browser.ts';
import { pethOutcome } from '../../lib/peth-run.ts';
import { placeOutcome, placeOutcomeFromRun } from '../../lib/place-run.ts';
import type { PlotEntry } from '../../lib/results-explorer.ts';
import { clearPlotRequest, requestPlot } from '../../lib/results-nav.ts';
import type { AnalysisId } from '../../lib/runs.ts';
import { AurocResults } from '../AurocResults.tsx';
import { DecodingResults } from '../DecodingResults.tsx';
import { PethResults } from '../PethResults.tsx';
import { PlaceResults } from '../PlaceResults.tsx';
import { runSource } from '../../lib/results-store.ts';

/** The page component of an analysis on this run's outcome (drawn when called), or why it cannot be. */
async function outcomeOf(r: RunRecord, onEdit: () => void): Promise<{ draw: () => JSX.Element }> {
  const analysis = r.analysis as AnalysisId;
  if (analysis === 'place') {
    const out = r.engine === 'framework' ? await placeOutcomeFromRun(r) : placeOutcome();
    if (out) return { draw: () => <PlaceResults out={out} changes={[]} onEdit={onEdit} /> };
  } else if (analysis === 'auroc') {
    const out = r.engine === 'framework' ? await aurocOutcomeFromRun(r) : aurocOutcome();
    if (out) return { draw: () => <AurocResults out={out} onEdit={onEdit} /> };
  } else if (analysis === 'peth') {
    const out = pethOutcome();
    if (out) return { draw: () => <PethResults out={out} onEdit={onEdit} /> };
  } else if (analysis === 'decoding') {
    const run = browserRun();
    if (r.engine === 'framework')
      return { draw: () => <DecodingResults source={runSource(r.run_id)} record={r} saved /> };
    if (run)
      return {
        draw: () => (
          <DecodingResults
            source={run.source}
            overallTested
            overallP={run.overallP}
            settings={run.settings}
            engine="browser"
          />
        ),
      };
  }
  throw new Error('This run is no longer in memory. Run the analysis again to draw this plot.');
}

export function PagePlot(props: {
  record: RunRecord;
  plot: PlotEntry;
  /** The page's Edit settings button: the window loads the run's settings into Configure. */
  onEdit: () => void;
}): JSX.Element {
  // The page reads the request when it mounts; one it does not have for this run is dropped on leaving.
  // eslint-disable-next-line solid/reactivity
  requestPlot(props.record.analysis as AnalysisId, props.plot.view);
  onCleanup(clearPlotRequest);
  const [page] = createResource(() => outcomeOf(props.record, props.onEdit));
  return (
    <div class="cb-rx__page">
      <Show when={page.error}>
        <p class="cb-ex__warn" role="alert">
          {page.error instanceof Error ? page.error.message : String(page.error)}
        </p>
      </Show>
      <Show when={page.loading}>
        <p class="cb-muted" role="status">
          Reading the saved run.
        </p>
      </Show>
      {/* Reading a resource in its error state throws, so only read it when there is no error. */}
      <Show when={!page.error && page()}>{(p) => p()!.draw()}</Show>
    </div>
  );
}
