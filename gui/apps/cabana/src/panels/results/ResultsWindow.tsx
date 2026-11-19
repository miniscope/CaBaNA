// The Results window: one run of one analysis, over whatever page opened it. Title, Actions and ×;
// the run picker with its settings and type pills; four views (Overview, Visualizations, Tables,
// Statistics); and on the right the Summary and Run information. Closing it leaves the page
// underneath as it was. What differs between analyses is supplied as `ExplorerParts`.

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
import { RunTypePill, SettingsPill } from '../../components/Pill.tsx';
import type { MenuItem } from '../../lib/actions-menu.ts';
import type { RunRecord } from '../../lib/bridge-client.ts';
import { bridgeReady } from '../../lib/bridge-status.ts';
import type { ExplorerData } from '../../lib/explorer-data.ts';
import { resultIndex } from '../../lib/result-index.ts';
import { runType } from '../../lib/preview.ts';
import { exportItems } from '../../lib/results-export.ts';
import { loadFrameworkExtra } from '../../lib/results-framework.ts';
import { matchOfRecord } from '../../lib/results-match.ts';
import {
  closeExplorer,
  explorerTarget,
  openExplorer,
  type ExplorerTarget,
} from '../../lib/results-nav.ts';
import { analysisLabel, hasResults } from '../../lib/results-overview.ts';
import { aurocModel, placeCells } from '../../lib/results-saved.ts';
import { isNewestOfType, settingsStatus } from '../../lib/results-runs.ts';
import { reasonText } from '../../lib/results-table.ts';
import { windowRuns, type WindowView } from '../../lib/results-window.ts';
import { active } from '../../lib/runs.ts';
import { openConfigCompare } from '../../lib/project-dialogs.ts';
import { goToStep } from '../../lib/store.ts';
import { applyRunSettings } from '../AnalysisRunSettings.tsx';
import { DeleteOutputs } from './DeleteOutputs.tsx';
import { DeleteRun } from './DeleteRun.tsx';
import { deleteItems, forgetDeletedRun } from './run-delete-items.ts';
import type { ExplorerParts } from './explorer-parts.ts';
import { StatisticsPane, TablesPane } from './ExplorerPanes.tsx';
import { decodingParts, populationParts } from './FrameworkExplorers.tsx';
import { createPlotChoice } from './plot-choice.ts';
import { openPlotEditor } from './PlotEditor.tsx';
import { pethParts } from './PethExplorer.tsx';
import { RunInfoCard, RunInfoWindow } from './RunInfo.tsx';
import { RunPicker } from './RunPicker.tsx';
import { savedData } from './run-data.ts';
import { SettingsCompare } from './SettingsCompare.tsx';
import { aurocParts, placeParts } from './TableExplorers.tsx';
import { OverviewPane, SummaryCard } from './WindowOverview.tsx';
import { VisPane } from './WindowVis.tsx';

type Dialog = 'info' | 'compare' | 'delete' | 'outputs';

const icon = (path: JSX.Element) => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
    aria-hidden="true"
  >
    {path}
  </svg>
);
const VIEWS: { id: WindowView; label: string; icon: JSX.Element }[] = [
  { id: 'overview', label: 'Overview', icon: icon(<path d="M3 13V8M8 13V3M13 13V6" />) },
  {
    id: 'vis',
    label: 'Visualizations',
    icon: icon(
      <>
        <rect x="2" y="3" width="12" height="10" rx="1.5" />
        <path d="M2 11l4-4 3 3 2-2 3 3" />
      </>,
    ),
  },
  {
    id: 'tables',
    label: 'Tables',
    icon: icon(
      <>
        <rect x="2" y="3" width="12" height="10" rx="1.5" />
        <path d="M2 7h12M6 3v10" />
      </>,
    ),
  },
  { id: 'stats', label: 'Statistics', icon: icon(<path d="M12 3H4l4 5-4 5h8" />) },
];

/** Mounted once for the app: the window opens whenever an analysis's results are asked for. */
export function ResultsWindowHost(): JSX.Element {
  return <Show when={explorerTarget()}>{(target) => <ResultsWindow target={target()} />}</Show>;
}

function ResultsWindow(props: { target: ExplorerTarget }): JSX.Element {
  const records = resultIndex;
  const analysis = () => props.target.analysis;
  const label = () => analysisLabel(analysis());
  const runs = createMemo(() => windowRuns(records(), analysis()));
  const record = createMemo(() =>
    props.target.runId ? records().find((r) => r.run_id === props.target.runId) : runs()[0],
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
    ({ r }) => matchOfRecord(r, isNewestOfType(r, records())).catch(() => undefined),
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

  const [view, setView] = createSignal<WindowView>('overview');
  const [infoOpen, setInfoOpen] = createSignal(innerHeight >= 800);
  const [dialog, setDialog] = createSignal<Dialog>();
  const [error, setError] = createSignal('');
  const plot = createPlotChoice(record, parts, data, records);
  // Another analysis starts from its Overview; another run of the same one keeps the view.
  createEffect(
    on(
      analysis,
      () => {
        setView('overview');
        plot.pick(undefined);
      },
      { defer: true },
    ),
  );

  const status = (rec: RunRecord) => {
    const s = settingsStatus(rec, isNewestOfType(rec, records()), match());
    const reason = match() && !match()!.matches ? reasonText(match()!.diff) : s.reason;
    return { status: s, reason: s.kind === 'needs_rerun' ? reason : undefined };
  };
  const running = () => active()?.id === analysis();

  const applySettings = (rec: RunRecord) => {
    setError('');
    const problem = applyRunSettings(rec);
    if (problem) return setError(problem);
    closeExplorer();
    goToStep('analyze');
  };
  const figures = () => {
    const spec = plot.current()?.view?.editSpec?.();
    return {
      run: () => spec && openPlotEditor(spec),
      disabled: spec
        ? undefined
        : plot.current()?.page
          ? 'Use the Export menu on the plot itself, or choose a plot type with a figure to restyle.'
          : 'This plot has no figure to restyle yet.',
    };
  };
  const actions = (rec: RunRecord): MenuItem[] => [
    { kind: 'action', label: 'Apply settings to new run', onSelect: () => applySettings(rec) },
    {
      kind: 'category',
      label: 'Export',
      items: exportItems(rec, data(), () => savedData(rec), figures(), setError),
    },
    ...deleteItems(running(), () => setDialog('outputs'), () => setDialog('delete')),
  ];

  const afterDelete = (r: RunRecord) => {
    forgetDeletedRun(r);
    const next = runs().find((x) => x.run_id !== r.run_id);
    if (next) openExplorer(analysis(), next.run_id);
    else closeExplorer();
  };

  const counts = (v: WindowView) =>
    data()
      ? v === 'tables'
        ? data()!.tables.length
        : v === 'stats'
          ? data()!.stats.length
          : undefined
      : undefined;
  const header = (rec: RunRecord) => (
    <>
      <RunPicker
        runs={runs()}
        records={records()}
        current={rec}
        onPick={(r) => openExplorer(analysis(), r.run_id)}
        onCompare={() => setDialog('compare')}
      />
      <SettingsPill status={status(rec).status} reason={status(rec).reason} />
      <RunTypePill type={runType(rec)} />
      <Show when={status(rec).reason}>
        <span class="cb-rx__why">{status(rec).reason}</span>
      </Show>
      <span class="cb-spacer" />
      <span class="cb-seg cb-win__views" role="group" aria-label="View">
        <For each={VIEWS}>
          {(v) => (
            <button
              type="button"
              classList={{ 'cb-seg__on': view() === v.id }}
              aria-pressed={view() === v.id}
              onClick={() => setView(v.id)}
            >
              {v.icon}
              {v.label}
              <Show when={counts(v.id) !== undefined}> ({counts(v.id)})</Show>
            </button>
          )}
        </For>
      </span>
    </>
  );

  return (
    <Modal
      label={`Results, ${label()}`}
      title={`Results — ${label()}`}
      inset={{ x: 64, y: 40 }}
      headClass="cb-win__head"
      onClose={closeExplorer}
      bar={<Show when={record()}>{(rec) => <div class="cb-win__bar">{header(rec())}</div>}</Show>}
      actions={<Show when={record()}>{(rec) => <ActionsMenu items={() => actions(rec())} />}</Show>}
    >
      <Show
        when={record()}
        fallback={
          <p class="cb-res__empty" role="status">
            This run is no longer saved.{' '}
            <button type="button" class="cb-link" onClick={closeExplorer}>
              Close
            </button>
          </p>
        }
      >
        {(rec) => (
          <div class="cb-win">
            <Show when={error()}>
              <p class="cb-ex__warn" role="alert">
                {error()}{' '}
                <button type="button" class="cb-link" onClick={() => setError('')}>
                  Dismiss
                </button>
              </p>
            </Show>
            <Show when={data.error}>
              <p class="cb-ex__warn" role="alert">
                Could not read this run:{' '}
                {data.error instanceof Error ? data.error.message : String(data.error)}
              </p>
            </Show>
            <Show when={view() === 'tables' || view() === 'stats'}>
              <div class="cb-win__full">
                <Show
                  when={data()}
                  fallback={<p class="cb-muted">{data.loading ? 'Reading the saved run.' : ''}</p>}
                >
                  {(d) => (
                    <Show
                      when={view() === 'tables'}
                      fallback={<StatisticsPane record={rec()} data={d()} />}
                    >
                      <TablesPane data={d()} />
                    </Show>
                  )}
                </Show>
              </div>
            </Show>
            <Show when={view() === 'overview' || view() === 'vis'}>
              <div class="cb-win__grid">
                <div class="cb-win__main">
                  <Show
                    when={view() === 'vis'}
                    fallback={
                      <OverviewPane
                        record={rec()}
                        data={data()}
                        headline={parts()?.headline?.()}
                        main={plot.choices().find((c) => c.view)}
                        onOpenPlots={() => {
                          plot.pick(plot.choices().find((c) => c.view)?.id);
                          setView('vis');
                        }}
                      />
                    }
                  >
                    <VisPane
                      record={rec()}
                      choices={plot.choices()}
                      current={plot.current()}
                      onPick={plot.pick}
                      loading={data.loading}
                      note={data()?.tablesNote}
                      onEdit={() => applySettings(rec())}
                    />
                  </Show>
                </div>
                <div class="cb-win__side">
                  <SummaryCard record={rec()} data={data()} summary={parts()?.summary} />
                  <RunInfoCard
                    record={rec()}
                    open={infoOpen()}
                    onToggle={() => setInfoOpen(!infoOpen())}
                    onFull={() => setDialog('info')}
                  />
                </div>
              </div>
            </Show>
            <Show when={dialog() === 'info'}>
              <RunInfoWindow
                record={rec()}
                data={data()}
                status={{ text: status(rec()).status.text, reason: status(rec()).reason }}
                figures={plot.choices().length}
                onCompare={() => openConfigCompare('analysis.yaml', rec())}
                onApply={() => {
                  setDialog(undefined);
                  applySettings(rec());
                }}
                onClose={() => setDialog(undefined)}
              />
            </Show>
            <Show when={dialog() === 'compare'}>
              <SettingsCompare
                record={rec()}
                others={runs().filter((x) => x.run_id !== rec().run_id)}
                onClose={() => setDialog(undefined)}
              />
            </Show>
            <Show when={dialog() === 'outputs'}>
              <DeleteOutputs
                record={rec()}
                onDone={closeExplorer}
                onClose={() => setDialog(undefined)}
              />
            </Show>
            <Show when={dialog() === 'delete'}>
              <DeleteRun
                record={rec()}
                records={records()}
                onDeleted={afterDelete}
                onClose={() => setDialog(undefined)}
              />
            </Show>
          </div>
        )}
      </Show>
    </Modal>
  );
}
