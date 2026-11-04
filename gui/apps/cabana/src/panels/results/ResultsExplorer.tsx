import { createMemo, createResource, createSignal, For, Show, type JSX } from 'solid-js';
import type { RunRecord } from '../../lib/bridge-client.ts';
import { bridgeReady } from '../../lib/bridge-status.ts';
import { loadExplorerData, type ExplorerData } from '../../lib/explorer-data.ts';
import { browserOutcomeInMemory, showBrowserOutcome } from '../../lib/live-outcome.ts';
import {
  closeExplorer,
  openExplorer,
  requestPlot,
  type ExplorerTarget,
} from '../../lib/results-nav.ts';
import { plotsAvailable, plotsOf, type PlotEntry } from '../../lib/results-explorer.ts';
import {
  analysisLabel,
  formatWhen,
  goToAnalysis,
  hasResults,
  openResult,
} from '../../lib/results-overview.ts';
import { compareToRecord, type AnalysisId } from '../../lib/runs.ts';
import { preliminaryText } from '../../lib/preview.ts';
import { ANALYSES } from '../../lib/analyses.ts';
import { PREVIEW_TEXT } from '../../lib/preview.ts';
import { InfoTip } from '../InfoTip.tsx';
import { setResultMethod, setShowOverview } from '../population/view-store.ts';
import type { PopulationMethod } from '../../lib/population-settings.ts';
import { ExportPane, StatisticsPane, SummaryPane, TablesPane } from './ExplorerPanes.tsx';
import { RunBadges, type Match } from './RunBanner.tsx';

type Section = 'overview' | 'plots' | 'tables' | 'statistics' | 'summary' | 'export';

/** Show one plot of a run on its analysis page. Opening never changes a setting. */
function openPlot(record: RunRecord, plot: PlotEntry): void {
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

function OverviewPane(props: {
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

function PlotsPane(props: {
  record: RunRecord;
  plots: PlotEntry[];
  /** The newest browser-engine run of this analysis: the one whose outcome may still be in memory. */
  newestBrowserId?: string;
}): JSX.Element {
  const state = () =>
    plotsAvailable(props.record, {
      inMemory: browserOutcomeInMemory(props.record.analysis as AnalysisId),
      newestRunId: props.newestBrowserId,
    });
  return (
    <>
      <div class="cb-ex__bar">
        <h3>Plots</h3>
        <span class="cb-muted">
          Each opens the interactive view on the analysis page at that plot.
        </span>
      </div>
      <Show
        when={(() => {
          const s = state();
          return s.ok ? undefined : s.reason;
        })()}
      >
        {(why) => (
          <p class="cb-ex__warn" role="status">
            {why()}
          </p>
        )}
      </Show>
      <div class="cb-ex__scroll">
        <Show
          when={props.plots.length}
          fallback={<p class="cb-muted">No plots listed for this run.</p>}
        >
          <ul class="cb-ex__plots">
            <For each={props.plots}>
              {(p) => (
                <li class="cb-ex__plot">
                  <strong>{p.title}</strong>
                  <p>{p.text}</p>
                  <button
                    type="button"
                    class="btn-primary btn-small"
                    disabled={!state().ok}
                    onClick={() => openPlot(props.record, p)}
                  >
                    Open plot
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </>
  );
}

/** One analysis's saved run: overview, plots, tables, statistics, summary and export. */
export function ResultsExplorer(props: {
  target: ExplorerTarget;
  records: RunRecord[];
}): JSX.Element {
  const [section, setSection] = createSignal<Section>('overview');
  const analysis = () => props.target.analysis;
  const record = createMemo(() => {
    const mine = props.records.filter((r) => r.analysis === analysis());
    return props.target.runId
      ? mine.find((r) => r.run_id === props.target.runId)
      : mine.find(hasResults);
  });
  const [data] = createResource(
    () => {
      const r = record();
      return r && hasResults(r) ? { r, up: bridgeReady() } : undefined;
    },
    ({ r }) => loadExplorerData(r),
  );
  const [match] = createResource(
    () => {
      const r = record();
      return r && r.engine === 'framework' && bridgeReady() ? r : undefined;
    },
    (r) => compareToRecord(r.analysis as AnalysisId, r).catch(() => undefined),
  );
  const newestBrowser = () =>
    props.records.find(
      (r) => r.analysis === analysis() && r.engine === 'browser-ts' && hasResults(r),
    );
  const plots = () => {
    const r = record();
    return r
      ? plotsOf(analysis(), data()?.resultNames ?? r.result_names ?? [], data()?.target)
      : [];
  };
  const label = () => ANALYSES.find((a) => a.id === analysis())?.label ?? analysisLabel(analysis());
  const SECTIONS = (): [Section, string, number | undefined][] => [
    ['overview', 'Overview', undefined],
    ['plots', 'Plots', plots().length],
    ['tables', 'Tables', data()?.tables.length],
    ['statistics', 'Statistics', data()?.stats.length],
    ['summary', 'Summary', undefined],
    ['export', 'Export', undefined],
  ];
  return (
    <div class="cb-ex">
      <div class="cb-ex__crumb">
        <button type="button" class="cb-link" onClick={closeExplorer}>
          Results
        </button>
        <span class="cb-muted">›</span>
        <span>{label()}</span>
      </div>
      <Show
        when={record()}
        fallback={
          <p class="cb-res__empty" role="status">
            This run is no longer saved.{' '}
            <button type="button" class="cb-link" onClick={closeExplorer}>
              Back to Results
            </button>
          </p>
        }
      >
        {(rec) => (
          <>
            <div class="cb-ex__head">
              <h2>{label()} results</h2>
              <InfoTip label="About the Explorer">
                <p>
                  The Explorer reads one saved run. Plots open on the analysis page; tables,
                  statistics and the summary are read from what the run saved.
                </p>
              </InfoTip>
              <RunBadges record={rec()} match={match()} />
              <span class="cb-ex__side">
                <Show
                  when={
                    props.target.runId &&
                    rec().run_id !==
                      props.records.find((r) => r.analysis === analysis() && hasResults(r))?.run_id
                  }
                >
                  <button
                    type="button"
                    class="btn-secondary btn-small"
                    onClick={() => openExplorer(analysis())}
                  >
                    Go to latest run
                  </button>
                </Show>
                <button
                  type="button"
                  class="btn-secondary"
                  onClick={() => goToAnalysis(analysis())}
                >
                  Edit analysis
                </button>
              </span>
            </div>
            <div class="cb-ex__body">
              <nav class="cb-ex__nav" aria-label="Explorer sections">
                <For each={SECTIONS()}>
                  {([id, text, n]) => (
                    <button
                      type="button"
                      classList={{ 'cb-ex__on': section() === id }}
                      aria-current={section() === id ? 'page' : undefined}
                      onClick={() => setSection(id)}
                    >
                      <span>{text}</span>
                      <Show when={n !== undefined}>
                        <span class="cb-muted">{n}</span>
                      </Show>
                    </button>
                  )}
                </For>
              </nav>
              <div class="cb-ex__main">
                <Show when={data.error}>
                  <p class="cb-ex__warn" role="alert">
                    Could not read this run:{' '}
                    {data.error instanceof Error ? data.error.message : String(data.error)}
                  </p>
                </Show>
                <Show when={!hasResults(rec())}>
                  <p class="cb-muted">This run produced no results.</p>
                </Show>
                <Show when={section() === 'overview'}>
                  <OverviewPane
                    record={rec()}
                    data={data()}
                    match={match()}
                    plots={plots().length}
                  />
                </Show>
                <Show when={section() === 'plots'}>
                  <PlotsPane
                    record={rec()}
                    plots={plots()}
                    newestBrowserId={newestBrowser()?.run_id}
                  />
                </Show>
                <Show when={data()}>
                  {(d) => (
                    <>
                      <Show when={section() === 'tables'}>
                        <TablesPane data={d()} />
                      </Show>
                      <Show when={section() === 'statistics'}>
                        <StatisticsPane data={d()} />
                      </Show>
                      <Show when={section() === 'summary'}>
                        <SummaryPane record={rec()} data={d()} />
                      </Show>
                      <Show when={section() === 'export'}>
                        <ExportPane record={rec()} data={d()} />
                      </Show>
                    </>
                  )}
                </Show>
                <Show when={data.loading && section() !== 'overview' && section() !== 'plots'}>
                  <p class="cb-muted" role="status">
                    Reading the saved run.
                  </p>
                </Show>
              </div>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
