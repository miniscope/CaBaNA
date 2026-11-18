// Facts of one saved run (the top of Run details) and the way a plot opens on its analysis page.

import { For, Show, type JSX } from 'solid-js';
import type { RunRecord } from '../../lib/bridge-client.ts';
import { bridgeReady } from '../../lib/bridge-status.ts';
import type { ExplorerData } from '../../lib/explorer-data.ts';
import { showBrowserOutcome } from '../../lib/live-outcome.ts';
import type { PopulationMethod } from '../../lib/population-settings.ts';
import { PREVIEW_TEXT, preliminaryText } from '../../lib/preview.ts';
import type { PlotEntry } from '../../lib/results-explorer.ts';
import type { Match } from '../../lib/results-match.ts';
import { requestPlot } from '../../lib/results-nav.ts';
import { formatWhen, goToAnalysis, openResult } from '../../lib/results-overview.ts';
import type { AnalysisId } from '../../lib/runs.ts';
import { setResultMethod, setShowOverview } from '../population/view-store.ts';

/** Show one plot of a run on its analysis page. Opening never changes a setting. */
export function openPlot(record: RunRecord, plot: PlotEntry): void {
  const analysis = record.analysis as AnalysisId;
  requestPlot(analysis, plot.view);
  if (analysis === 'population') {
    setResultMethod(plot.view as PopulationMethod);
    setShowOverview(false);
  }
  if (record.engine === 'framework') openResult(analysis, record.run_id);
  else {
    showBrowserOutcome(analysis);
    goToAnalysis(analysis);
  }
}

const Row = (p: { k: string; children: JSX.Element }) => (
  <tr>
    <th scope="row">{p.k}</th>
    <td>{p.children}</td>
  </tr>
);

export function OverviewPane(props: {
  record: RunRecord;
  data?: ExplorerData;
  match?: Match;
  plots: number;
}): JSX.Element {
  const r = () => props.record;
  const rowCount = () => props.data?.tables.reduce((n, t) => n + t.rows.length, 0) ?? 0;
  const matchText = () =>
    r().engine !== 'framework'
      ? 'Not compared (browser-engine runs are not matched to the setup)'
      : !bridgeReady()
        ? 'Needs the Python engine to compare'
        : props.match
          ? props.match.matches
            ? 'Matches current settings'
            : `Settings changed since this run${props.match.diff.length ? ` (${props.match.diff.join('; ')})` : ''}`
          : 'Checking';
  return (
    <>
      <h3>Overview</h3>
      <div class="cb-ex__scroll">
        <table class="cb-rd__t">
          <tbody>
            <Row k="Run">{r().run_id}</Row>
            <Row k="Saved">
              {formatWhen(r().created_utc)}
              {r().finished_utc ? `, finished ${formatWhen(r().finished_utc)}` : ''}
            </Row>
            <Row k="Engine">
              {r().engine === 'framework' ? 'Python framework' : 'Browser engine'}
            </Row>
            <Row k="Scope">
              {r().scope === 'preview'
                ? `Preliminary (quick preview): ${preliminaryText(r())}. ${PREVIEW_TEXT}.`
                : 'Full analysis'}
            </Row>
            <Row k="Settings">{matchText()}</Row>
            <Row k="Status">{r().status}</Row>
          </tbody>
        </table>
        <Show when={props.data}>
          <ul class="cb-ex__counts" aria-label="Key counts" style={{ 'margin-top': '12px' }}>
            <li>
              <b>{props.plots}</b>plots
            </li>
            <li>
              <b>{props.data!.tables.length}</b>tables ({rowCount()} rows)
            </li>
            <li>
              <b>{props.data!.stats.length}</b>statistics
            </li>
            <For each={props.data!.stats.slice(0, 4)}>
              {(s) => (
                <li>
                  <b>{s.n}</b>
                  {s.basis ?? 'values'}: {s.name}
                </li>
              )}
            </For>
            <Show when={props.data!.stats.find((s) => s.test?.shuffles)}>
              {(s) => (
                <li>
                  <b>{s().test!.shuffles}</b>shuffles
                </li>
              )}
            </Show>
          </ul>
        </Show>
      </div>
    </>
  );
}
