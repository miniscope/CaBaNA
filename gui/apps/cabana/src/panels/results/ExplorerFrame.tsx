import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  Show,
  type JSX,
} from 'solid-js';
import { ActionsMenu } from '../../components/ActionsMenu.tsx';
import { Modal } from '../../components/Modal.tsx';
import { Pill } from '../../components/Pill.tsx';
import type { MenuItem } from '../../lib/actions-menu.ts';
import { bridge, type RunRecord } from '../../lib/bridge-client.ts';
import { bridgeReady } from '../../lib/bridge-status.ts';
import { browserOutcomeInMemory } from '../../lib/live-outcome.ts';
import { executedShuffles, preliminaryText } from '../../lib/preview.ts';
import { exportItems } from '../../lib/results-export.ts';
import { plotsAvailable, plotsOf, summarySentences } from '../../lib/results-explorer.ts';
import { matchOfRecord } from '../../lib/results-match.ts';
import { closeExplorer, openExplorer, type ExplorerTarget } from '../../lib/results-nav.ts';
import { analysisLabel, formatWhen, hasResults } from '../../lib/results-overview.ts';
import { DELETE_OUTPUTS_NEEDS, reasonText } from '../../lib/results-table.ts';
import { active, type AnalysisId } from '../../lib/runs.ts';
import { AnalysisRunSettings } from '../AnalysisRunSettings.tsx';
import { InfoTip } from '../InfoTip.tsx';
import { DeleteRun } from './DeleteRun.tsx';
import type { ExplorerParts } from './explorer-parts.ts';
import { StatisticsPane, SummaryPane, TablesPane } from './ExplorerPanes.tsx';
import { pethParts } from './PethExplorer.tsx';
import { aurocParts, placeParts } from './TableExplorers.tsx';
import { decodingParts, populationParts } from './FrameworkExplorers.tsx';
import type { ExplorerData } from '../../lib/explorer-data.ts';
import { loadFrameworkExtra } from '../../lib/results-framework.ts';
import { aurocModel, placeCells } from '../../lib/results-saved.ts';
import { openPlotEditor } from './PlotEditor.tsx';
import { OverviewPane, openPlot } from './RunFacts.tsx';
import { RunDetailsBody } from './RunDetails.tsx';
import { savedData } from './run-data.ts';

/** The analyses the shared frame explores. */
export const FRAMED: AnalysisId[] = ['place', 'auroc', 'peth', 'decoding', 'population'];

type View = 'main' | 'tables' | 'statistics' | 'summary';

/** Run details: the facts of the run, then the settings, inputs and framework it was made with. */
function RunDetailsWindow(props: {
  record: RunRecord;
  data?: Parameters<typeof OverviewPane>[0]['data'];
  match?: Parameters<typeof OverviewPane>[0]['match'];
  plots: number;
  onClose: () => void;
}): JSX.Element {
  const [pipeline] = createResource(
    () => (bridgeReady() && props.record.pipeline_file ? props.record.run_id : undefined),
    (id) => bridge.runFile(id, props.record.pipeline_file!).catch(() => undefined),
  );
  return (
    <Modal label="Run details" title="Run details" width={640} onClose={props.onClose}>
      <OverviewPane
        record={props.record}
        data={props.data}
        match={props.match}
        plots={props.plots}
      />
      <RunDetailsBody record={props.record} pipeline={pipeline()} />
    </Modal>
  );
}

/**
 * The Results explorer for one analysis: breadcrumb, run picker, status pills and Actions on top;
 * the main plot on the left, the Summary card on the right. What differs between analyses is
 * supplied as `ExplorerParts`. Every other plot and table stays reachable from the View selector.
 */
export function ExplorerFrame(props: {
  target: ExplorerTarget;
  records: RunRecord[];
  onDeleted: (r: RunRecord) => void;
  onError: (message: string) => void;
}): JSX.Element {
  const analysis = () => props.target.analysis;
  const label = () => analysisLabel(analysis());
  const runs = createMemo(() =>
    props.records
      .filter((r) => r.analysis === analysis() && hasResults(r))
      .sort((a, b) => b.created_utc.localeCompare(a.created_utc)),
  );
  const record = createMemo(() =>
    props.target.runId ? props.records.find((r) => r.run_id === props.target.runId) : runs()[0],
  );
  const [data] = createResource(
    () => {
      const r = record();
      return r && hasResults(r) ? { r, up: bridgeReady() } : undefined;
    },
    ({ r }) => savedData(r),
  );
  const [match] = createResource(
    () => {
      const r = record();
      return r ? { r, up: bridgeReady() } : undefined;
    },
    ({ r }) => matchOfRecord(r, runs()[0]?.run_id === r.run_id).catch(() => undefined),
  );
  // A framework run's arrays: the auROC grid, place-cell values and maps, and what Decoding and
  // Population read their views from.
  const [extra] = createResource(
    () => {
      const r = record();
      return r && hasResults(r) && r.engine === 'framework' ? { r, up: bridgeReady() } : undefined;
    },
    ({ r }) => loadFrameworkExtra(r).catch(() => undefined),
  );
  const table = (d: ExplorerData, name: string) => d.tables.find((t) => t.name === name);
  const parts = createMemo((): ExplorerParts | undefined => {
    const [r, d, x] = [record(), data(), extra()];
    if (!r || !d) return undefined;
    switch (analysis()) {
      case 'peth':
        return pethParts(r, d);
      case 'auroc':
        return aurocParts(x?.auroc ?? aurocModel(table(d, 'auroc.csv')), d);
      case 'place':
        return placeParts(
          x?.place?.cells ?? placeCells(table(d, 'place_cells.csv')),
          x?.place?.maps,
          d,
        );
      case 'decoding':
        return x && r.engine === 'framework' ? decodingParts(r, x, d) : undefined;
      case 'population':
        return x && r.engine === 'framework' ? populationParts(r, x, d) : undefined;
    }
  });

  const [view, setView] = createSignal<View>('main');
  createEffect(
    on(
      () => record()?.run_id,
      () => setView('main'),
      { defer: true },
    ),
  );
  // With no main plot to draw from the saved tables, the card opens on Statistics.
  const shown = () => (view() === 'main' && !parts() && data() ? 'statistics' : view());
  const [dialog, setDialog] = createSignal<'settings' | 'details' | 'delete'>();

  const plots = () => {
    const r = record();
    return r
      ? plotsOf(analysis(), data()?.resultNames ?? r.result_names ?? [], data()?.target)
      : [];
  };
  const plotState = () => {
    const r = record();
    const newest = props.records.find(
      (x) => x.analysis === analysis() && x.engine === 'browser-ts' && hasResults(x),
    );
    return r
      ? plotsAvailable(r, {
          inMemory: browserOutcomeInMemory(analysis()),
          newestRunId: newest?.run_id,
        })
      : { ok: false as const, reason: 'No run.' };
  };
  const chooseView = (value: string) => {
    const r = record();
    if (value.startsWith('plot:')) {
      const plot = plots().find((p) => p.id === value.slice(5));
      if (r && plot) openPlot(r, plot);
    } else setView(value as View);
  };

  const running = () => active()?.id === analysis();
  const actions = (rec: RunRecord): MenuItem[] => [
    { kind: 'action', label: 'Settings used', onSelect: () => setDialog('settings') },
    { kind: 'action', label: 'Run details', onSelect: () => setDialog('details') },
    {
      kind: 'category',
      label: 'Export',
      items: exportItems(rec, () => savedData(rec), props.onError),
    },
    {
      kind: 'action',
      label: 'Edit plot',
      sub: 'Restyle and export the main plot',
      disabled: parts()?.editSpec ? undefined : 'This view has no plot to edit.',
      onSelect: () => {
        const spec = parts()?.editSpec?.();
        if (spec) openPlotEditor(spec);
      },
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Delete outputs (keep record)',
      disabled: DELETE_OUTPUTS_NEEDS,
      onSelect: () => undefined,
    },
    {
      kind: 'action',
      label: 'Delete run',
      danger: true,
      disabled: running()
        ? 'Wait for the run to finish.'
        : bridgeReady()
          ? undefined
          : 'Needs the Python engine.',
      onSelect: () => setDialog('delete'),
    },
  ];

  const afterDelete = (r: RunRecord) => {
    props.onDeleted(r);
    const next = runs().find((x) => x.run_id !== r.run_id);
    if (next) openExplorer(analysis(), next.run_id);
    else closeExplorer();
  };

  return (
    <div class="cb-ex2">
      <div class="cb-rx__title">
        <button type="button" class="cb-link" onClick={closeExplorer}>
          Results
        </button>
        <span class="cb-muted">›</span>
        <h2>{label()}</h2>
        <Show when={record()}>
          {(rec) => (
            <>
              <select
                class="cb-rx__pick"
                aria-label="Run"
                value={rec().run_id}
                onChange={(e) => openExplorer(analysis(), e.currentTarget.value)}
              >
                <For each={runs()}>
                  {(r) => (
                    <option value={r.run_id}>
                      {formatWhen(r.created_utc)}
                      {r.scope === 'preview' ? ' · preliminary' : ''}
                    </option>
                  )}
                </For>
                <Show when={!runs().some((r) => r.run_id === rec().run_id)}>
                  <option value={rec().run_id}>{formatWhen(rec().created_utc)}</option>
                </Show>
              </select>
              <Show
                when={match()}
                fallback={
                  <Pill tone="neutral" title="Cannot be compared with the settings now">
                    saved
                  </Pill>
                }
              >
                {(m) => (
                  <Show
                    when={m().matches}
                    fallback={
                      <Pill tone="corr" title={reasonText(m().diff)}>
                        needs rerun
                      </Pill>
                    }
                  >
                    <Pill tone="ok">current</Pill>
                  </Show>
                )}
              </Show>
              <Show
                when={rec().scope === 'preview'}
                fallback={
                  <Pill tone="ok">
                    full analysis
                    <Show when={parts()?.tested && executedShuffles(rec()) !== undefined}>
                      {' '}
                      · {executedShuffles(rec())!.toLocaleString()} shuffles
                    </Show>
                  </Pill>
                }
              >
                <Pill tone="flag" title="Quick preview with reduced shuffles">
                  {preliminaryText(rec()).toLowerCase()}
                </Pill>
              </Show>
              <span class="cb-spacer" />
              <ActionsMenu items={() => actions(rec())} />
            </>
          )}
        </Show>
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
            <div class="cb-ex2__grid">
              <section class="cb-rx__card" aria-label="Main plot">
                <div class="cb-rx__head">
                  <h3>
                    {shown() === 'main'
                      ? (parts()?.title() ?? `${label()} results`)
                      : { tables: 'Tables', statistics: 'Statistics', summary: 'Summary text' }[
                          shown() as Exclude<View, 'main'>
                        ]}
                  </h3>
                  <Show when={shown() === 'main' && parts()}>{(p) => p().help()}</Show>
                  <span class="cb-spacer" />
                  <select
                    class="cb-rx__pick"
                    aria-label="View"
                    value={shown()}
                    onChange={(e) => {
                      chooseView(e.currentTarget.value);
                      e.currentTarget.value = shown();
                    }}
                  >
                    <option value="main">{parts()?.mainLabel ?? 'Main plot'}</option>
                    <optgroup label="Saved results">
                      <option value="tables">
                        Tables{data() ? ` (${data()!.tables.length})` : ''}
                      </option>
                      <option value="statistics">
                        Statistics{data() ? ` (${data()!.stats.length})` : ''}
                      </option>
                      <option value="summary">Summary text</option>
                    </optgroup>
                    <Show when={plots().length}>
                      <optgroup
                        label={
                          plotState().ok
                            ? 'Open on the Analysis page'
                            : 'Analysis page plots (unavailable)'
                        }
                      >
                        <For each={plots()}>
                          {(p) => (
                            <option
                              value={`plot:${p.id}`}
                              disabled={!plotState().ok}
                              title={
                                plotState().ok ? p.text : (plotState() as { reason: string }).reason
                              }
                            >
                              {p.title}
                            </option>
                          )}
                        </For>
                      </optgroup>
                    </Show>
                  </select>
                </div>
                <Show when={data.error}>
                  <p class="cb-ex__warn" role="alert">
                    Could not read this run:{' '}
                    {data.error instanceof Error ? data.error.message : String(data.error)}
                  </p>
                </Show>
                <Show when={shown() === 'main' && parts()}>
                  <div class="cb-rx__subrow">
                    <p class="cb-muted cb-rx__sub">{parts()?.subtitle?.()}</p>
                    <Show when={shown() === 'main' && parts()?.switcher}>
                      {(s) => (
                        <span class="cb-seg" role="group" aria-label={s().label}>
                          <For each={s().options}>
                            {(name, i) => (
                              <button
                                type="button"
                                classList={{ 'cb-seg__on': s().index() === i() }}
                                aria-pressed={s().index() === i()}
                                onClick={() => s().set(i())}
                              >
                                {name}
                              </button>
                            )}
                          </For>
                        </span>
                      )}
                    </Show>
                  </div>
                </Show>
                <div class="cb-rx__body">
                  <Show when={shown() === 'main'}>
                    <Show
                      when={parts()}
                      fallback={
                        <p class="cb-muted" role="status">
                          {data.loading
                            ? 'Reading the saved run.'
                            : (data()?.tablesNote ??
                              'The saved tables this view needs are not available.')}
                        </p>
                      }
                    >
                      {(p) => p().main()}
                    </Show>
                  </Show>
                  <Show when={data()}>
                    {(d) => (
                      <>
                        <Show when={shown() === 'tables'}>
                          <TablesPane data={d()} />
                        </Show>
                        <Show when={shown() === 'statistics'}>
                          <StatisticsPane data={d()} />
                        </Show>
                        <Show when={shown() === 'summary'}>
                          <SummaryPane record={rec()} data={d()} />
                        </Show>
                      </>
                    )}
                  </Show>
                </div>
              </section>
              <aside class="cb-rx__card cb-rx__summary" aria-label="Summary">
                <div class="cb-rx__head">
                  <h3>Summary</h3>
                  <InfoTip label="About the summary">
                    <p>
                      Counts and cells are read from the saved result, with the correction and alpha
                      the run used. They are not recomputed here.
                    </p>
                  </InfoTip>
                </div>
                <Show
                  when={parts()}
                  fallback={
                    <Show when={data()} fallback={<p class="cb-muted">Reading the saved run.</p>}>
                      {(d) => (
                        <For each={summarySentences({ record: rec(), ...d().summary })}>
                          {(line) => <p class="cb-rx__p">{line}</p>}
                        </For>
                      )}
                    </Show>
                  }
                >
                  {(p) => p().summary()}
                </Show>
              </aside>
            </div>
            <Show when={dialog() === 'settings'}>
              <AnalysisRunSettings record={rec()} onClose={() => setDialog(undefined)} />
            </Show>
            <Show when={dialog() === 'details'}>
              <RunDetailsWindow
                record={rec()}
                data={data()}
                match={match()}
                plots={plots().length}
                onClose={() => setDialog(undefined)}
              />
            </Show>
            <Show when={dialog() === 'delete'}>
              <DeleteRun
                record={rec()}
                records={props.records}
                onDeleted={afterDelete}
                onClose={() => setDialog(undefined)}
              />
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
