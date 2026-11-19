// Previous results of one analysis: its saved runs, one row each with Type and Settings apart, the
// result and the size. Clicking a row opens that run in the Results window; each row has the same
// Actions menu as the window (View results, Apply settings to new run, View run details,
// Export, Delete outputs…, Delete run…).

import { createMemo, createResource, createSignal, For, Show, type JSX } from 'solid-js';
import { ActionsMenu } from '../components/ActionsMenu.tsx';
import { Modal } from '../components/Modal.tsx';
import { SettingsPill } from '../components/Pill.tsx';
import type { MenuItem } from '../lib/actions-menu.ts';
import { analysisWindow, setAnalysisWindow } from '../lib/analysis-window.ts';
import { ANALYSES } from '../lib/analyses.ts';
import type { RunRecord } from '../lib/bridge-client.ts';
import { openConfigCompare } from '../lib/project-dialogs.ts';
import { sizeText } from '../lib/project-view.ts';
import { resultIndex } from '../lib/result-index.ts';
import { exportItems } from '../lib/results-export.ts';
import { openExplorer } from '../lib/results-nav.ts';
import { formatWhen, openness } from '../lib/results-overview.ts';
import { runRows, type RunRow } from '../lib/results-runs.ts';
import { headlineOf } from '../lib/results-table.ts';
import { newestMatches } from '../lib/run-match.ts';
import { runSizes } from '../lib/run-size.ts';
import { active, type AnalysisId } from '../lib/runs.ts';
import { goToStep } from '../lib/store.ts';
import { applyRunSettings } from './AnalysisRunSettings.tsx';
import { DeleteOutputs } from './results/DeleteOutputs.tsx';
import { DeleteRun } from './results/DeleteRun.tsx';
import { forgetDeletedRun, deleteItems } from './results/run-delete-items.ts';
import { savedData } from './results/run-data.ts';
import { RunInfoWindow } from './results/RunInfo.tsx';

type Dialog = 'info' | 'outputs' | 'delete';

const NO_SIZE_TIP = 'Sizes need a saved project';

/** Mounted once for the app: the window opens from "All previous results…" on any page. */
export function PreviousResultsHost(): JSX.Element {
  const window = () => {
    const w = analysisWindow();
    return w?.kind === 'previous' ? w : undefined;
  };
  return (
    <Show when={window()}>
      {(w) => (
        <AnalysisPrevious
          id={w().id as AnalysisId}
          records={resultIndex()}
          onClose={() => setAnalysisWindow(undefined)}
        />
      )}
    </Show>
  );
}

function AnalysisPrevious(props: {
  id: AnalysisId;
  /** Every saved run of the project; this window lists the ones of its analysis. */
  records: RunRecord[];
  onClose: () => void;
}): JSX.Element {
  // One window per analysis: the id never changes while it is open.
  // eslint-disable-next-line solid/reactivity
  const id = props.id;
  const label = ANALYSES.find((a) => a.id === id)!.label;
  const matches = newestMatches(id);
  const rows = createMemo(() => runRows(props.records, (r) => matches().get(r.run_id), id));
  const [sizes] = createResource(() => runSizes());
  const [dialog, setDialog] = createSignal<{ kind: Dialog; record: RunRecord }>();
  const [error, setError] = createSignal('');
  const [info] = createResource(
    () => (dialog()?.kind === 'info' ? dialog()!.record : undefined),
    (r) => savedData(r).catch(() => undefined),
  );

  const open = (r: RunRecord) => {
    props.onClose();
    openExplorer(id, r.run_id);
  };
  const apply = (r: RunRecord) => {
    setError('');
    const problem = applyRunSettings(r);
    if (problem) return setError(problem);
    goToStep('analyze');
  };
  const items = (row: RunRow): MenuItem[] => {
    const r = row.record;
    const o = openness(r);
    return [
      {
        kind: 'action',
        label: 'View results',
        disabled: o.kind === 'blocked' ? o.reason : undefined,
        onSelect: () => open(r),
      },
      { kind: 'separator' },
      { kind: 'action', label: 'Apply settings to new run', onSelect: () => apply(r) },
      { kind: 'action', label: 'View run details', onSelect: () => setDialog({ kind: 'info', record: r }) },
      {
        kind: 'category',
        label: 'Export',
        items: exportItems(
          r,
          undefined,
          () => savedData(r),
          { run: () => undefined, disabled: 'Open the run to export its figures.' },
          setError,
        ),
      },
      ...deleteItems(
        active()?.id === id,
        () => setDialog({ kind: 'outputs', record: r }),
        () => setDialog({ kind: 'delete', record: r }),
      ),
    ];
  };

  return (
    <Modal
      label={`Previous results, ${label}`}
      title={`Previous results · ${label}`}
      head={
        <span class="cb-muted cb-cfg__data">
          {rows().length} saved run{rows().length === 1 ? '' : 's'} · click a run to open its
          results
        </span>
      }
      width={1020}
      height={440}
      onClose={props.onClose}
    >
      <Show
        when={rows().length}
        fallback={<p class="cb-muted">No runs yet. Run the analysis from its card.</p>}
      >
        <div class="cb-prev">
          <table class="cb-prev__table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Type</th>
                <th>Settings</th>
                <th>Result</th>
                <th>Size</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(row) => (
                  <PreviousRow
                    row={row}
                    bytes={sizes()?.get(row.record.run_id)}
                    items={() => items(row)}
                    onOpen={() => open(row.record)}
                  />
                )}
              </For>
            </tbody>
          </table>
          <Show when={error()}>
            <p class="cb-warn" role="alert">
              {error()}
            </p>
          </Show>
          <p class="cb-muted cb-prev__note">
            Type says how the run was made; Settings says whether it matches the settings and data
            in use now. A rerun adds a row; older rows stay until deleted.
          </p>
        </div>
      </Show>
      <Show when={dialog()}>
        {(d) => (
          <>
            <Show when={d().kind === 'info'}>
              <RunInfoWindow
                record={d().record}
                data={info()}
                status={{
                  text: rows().find((x) => x.record.run_id === d().record.run_id)?.status ?? '',
                }}
                onCompare={() => openConfigCompare('analysis.yaml', d().record)}
                onApply={() => {
                  setDialog(undefined);
                  apply(d().record);
                }}
                onClose={() => setDialog(undefined)}
              />
            </Show>
            <Show when={d().kind === 'outputs'}>
              <DeleteOutputs record={d().record} onClose={() => setDialog(undefined)} />
            </Show>
            <Show when={d().kind === 'delete'}>
              <DeleteRun
                record={d().record}
                records={props.records}
                onDeleted={forgetDeletedRun}
                onClose={() => setDialog(undefined)}
              />
            </Show>
          </>
        )}
      </Show>
    </Modal>
  );
}

function PreviousRow(props: {
  row: RunRow;
  bytes?: number;
  items: () => MenuItem[];
  onOpen: () => void;
}): JSX.Element {
  const r = () => props.row.record;
  const [headline] = createResource(
    () => r(),
    async (x) => {
      try {
        return headlineOf(x.analysis as AnalysisId, await savedData(x));
      } catch {
        return undefined;
      }
    },
  );
  const blocked = () => openness(r()).kind === 'blocked';
  return (
    <tr
      classList={{ 'cb-prev__row': !blocked() }}
      onClick={() => {
        if (!blocked()) props.onOpen();
      }}
    >
      <td>{formatWhen(r().finished_utc ?? r().created_utc)}</td>
      <td>{props.row.type.text}</td>
      <td>
        <SettingsPill status={props.row.settings} reason={props.row.settings.reason} />
      </td>
      <td>{blocked() ? <span class="cb-muted">{props.row.status}</span> : (headline() ?? '—')}</td>
      <td title={props.bytes === undefined ? NO_SIZE_TIP : undefined}>
        {props.bytes === undefined ? '—' : sizeText(props.bytes)}
      </td>
      <td class="cb-prev__act" onClick={(e) => e.stopPropagation()}>
        <ActionsMenu items={props.items} />
      </td>
    </tr>
  );
}
