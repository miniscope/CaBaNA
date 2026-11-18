import { createResource, createSignal, For, Show, type JSX } from 'solid-js';
import { ActionsMenu } from '../../components/ActionsMenu.tsx';
import { Pill } from '../../components/Pill.tsx';
import type { MenuItem } from '../../lib/actions-menu.ts';
import { openAnalysisWindow } from '../../lib/analysis-window.ts';
import { type RunRecord } from '../../lib/bridge-client.ts';
import { bridgeReady } from '../../lib/bridge-status.ts';
import { exportItems } from '../../lib/results-export.ts';
import type { Match } from '../../lib/results-match.ts';
import { openExplorer } from '../../lib/results-nav.ts';
import {
  failureMessage,
  formatWhen,
  goToAnalysis,
  hasResults,
} from '../../lib/results-overview.ts';
import {
  DELETE_OUTPUTS_NEEDS,
  headlineOf,
  STORAGE_NEEDS,
  tableCounts,
  tableRows,
  type TableRow,
} from '../../lib/results-table.ts';
import { active, type AnalysisId } from '../../lib/runs.ts';
import { goToStep } from '../../lib/store.ts';
import { PREVIEW_TEXT } from '../../lib/preview.ts';
import { InfoTip } from '../InfoTip.tsx';
import { DeleteRun } from './DeleteRun.tsx';
import { savedData } from './run-data.ts';

/** Open an analysis's own window over the Analysis page. */
function editAnalysis(id: AnalysisId, kind: 'configure' | 'previous') {
  goToStep('analyze');
  openAnalysisWindow(id, kind);
}

function Status(props: { row: TableRow }): JSX.Element {
  const r = () => props.row.record;
  return (
    <>
      <Show when={r()} fallback={<span class="cb-muted">No runs yet</span>}>
        {(rec) => (
          <>
            <Show when={props.row.status === 'needs_rerun'}>
              <Pill tone="corr">needs rerun</Pill>
            </Show>
            <Show when={props.row.status === 'current'}>
              <Pill tone="ok">current</Pill>
            </Show>
            <Show when={props.row.status === 'saved'}>
              <Pill tone="neutral" title="Cannot be compared with the settings now">
                saved
              </Pill>
            </Show>
            <Show when={props.row.status === 'running'}>
              <Pill tone="flag">running</Pill>
            </Show>
            <Show when={props.row.status === 'failed'}>
              <Pill tone="flag">{rec().status === 'failed' ? 'failed' : 'no results'}</Pill>
            </Show>
            <Show when={props.row.preliminary}>
              {' '}
              <Pill tone="flag" title={`Quick preview: ${PREVIEW_TEXT}`}>
                preliminary
              </Pill>
            </Show>
            <Show when={props.row.reason}>
              <span class="cb-rx__why">{props.row.reason}</span>
            </Show>
            <Show when={props.row.status === 'failed' && rec().status === 'failed'}>
              <span class="cb-rx__why">{failureMessage(rec())}</span>
            </Show>
          </>
        )}
      </Show>
    </>
  );
}

function Result(props: { row: TableRow }): JSX.Element {
  const [headline] = createResource(
    () => {
      const r = props.row.record;
      return r && hasResults(r) ? r : undefined;
    },
    async (r) => {
      try {
        return headlineOf(r.analysis as AnalysisId, await savedData(r));
      } catch {
        return undefined;
      }
    },
  );
  return (
    <Show
      when={props.row.record}
      fallback={
        <button
          type="button"
          class="cb-link"
          onClick={(e) => {
            e.stopPropagation();
            goToAnalysis(props.row.analysis);
          }}
        >
          Set up in Analysis
        </button>
      }
    >
      <Show
        when={hasResults(props.row.record!)}
        fallback={<span class="cb-muted">No results</span>}
      >
        {headline() ?? (
          <span class="cb-muted">{headline.loading ? 'Reading the run' : 'Saved result'}</span>
        )}
      </Show>
    </Show>
  );
}

function RowActions(props: {
  row: TableRow;
  onDelete: (r: RunRecord) => void;
  onError: (message: string) => void;
}): JSX.Element {
  const items = (): MenuItem[] => {
    const rec = props.row.record!;
    const id = props.row.analysis;
    const running = active()?.id === id || props.row.status === 'running';
    return [
      {
        kind: 'action',
        label: 'Explore results',
        disabled: hasResults(rec) ? undefined : 'This run produced no results.',
        onSelect: () => openExplorer(id, rec.run_id),
      },
      { kind: 'action', label: 'View previous runs', onSelect: () => editAnalysis(id, 'previous') },
      {
        kind: 'action',
        label: 'Edit analysis settings',
        onSelect: () => editAnalysis(id, 'configure'),
      },
      {
        kind: 'category',
        label: 'Export results',
        items: exportItems(rec, () => savedData(rec), props.onError),
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
        disabled: running
          ? 'Wait for the run to finish.'
          : bridgeReady()
            ? undefined
            : 'Needs the Python engine.',
        onSelect: () => props.onDelete(rec),
      },
    ];
  };
  return <ActionsMenu items={items} class="btn-secondary btn-small" />;
}

/**
 * Results overview: counts, then one table with a row per analysis. A row opens that analysis's
 * explorer; its Actions menu holds the rest (previous runs, settings, export, delete).
 */
export function ResultsTable(props: {
  records: RunRecord[];
  matchOf: (r: RunRecord) => Match | undefined;
  onDeleted: (r: RunRecord) => void;
  onError: (message: string) => void;
}): JSX.Element {
  const [deleting, setDeleting] = createSignal<RunRecord>();
  const rows = () => tableRows(props.records, props.matchOf);
  const counts = () => tableCounts(props.records, props.matchOf);
  const tiles = (): [string, number][] => [
    ['Saved runs', counts().saved],
    ['Current', counts().current],
    ['Need rerun', counts().needRerun],
    ['Preliminary', counts().preliminary],
  ];
  const explore = (row: TableRow) => {
    if (row.record && hasResults(row.record)) openExplorer(row.analysis, row.record.run_id);
  };
  return (
    <>
      <div class="cb-rx__title">
        <h2>Results</h2>
        <InfoTip label="About saved results">
          <p>
            Every saved run, with the settings and data version that produced it. Opening a result
            never changes the current settings.
          </p>
          <p>
            Current means the run matches the settings and inputs now. Needs rerun means they
            changed since. Preliminary means a quick preview: {PREVIEW_TEXT}.
          </p>
        </InfoTip>
        <span class="cb-spacer" />
        <ActionsMenu
          items={[
            {
              kind: 'action',
              label: 'Manage stored outputs',
              disabled: STORAGE_NEEDS,
              onSelect: () => undefined,
            },
          ]}
        />
        <For each={tiles()}>
          {([label, n]) => (
            <div class="cb-rx__count" aria-label={`${label}: ${n}`}>
              <span class="sc">{label}</span>
              <b>{n}</b>
            </div>
          )}
        </For>
      </div>
      <div class="cb-rx__card">
        <div class="cb-rx__scroll">
          <table class="cb-rx__table">
            <thead>
              <tr>
                <th>Analysis</th>
                <th>Latest run</th>
                <th>Status</th>
                <th>Result</th>
                <th>Runs</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(row) => (
                  <tr
                    data-analysis={row.analysis}
                    classList={{ 'cb-rx__row--open': !!row.record && hasResults(row.record) }}
                    onClick={() => explore(row)}
                  >
                    <td class="cb-rx__name">{row.label}</td>
                    <td>
                      {row.record ? (
                        formatWhen(row.record.created_utc)
                      ) : (
                        <span class="cb-muted">—</span>
                      )}
                    </td>
                    <td>
                      <Status row={row} />
                    </td>
                    <td>
                      <Result row={row} />
                    </td>
                    <td>{row.runs || ''}</td>
                    <td class="cb-rx__act" onClick={(e) => e.stopPropagation()}>
                      <Show when={row.record}>
                        <RowActions row={row} onDelete={setDeleting} onError={props.onError} />
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
        <p class="cb-muted cb-rx__note">
          A rerun keeps the old result; both stay listed until one is deleted. Click a row to
          explore it.
        </p>
      </div>
      <Show when={deleting()}>
        {(r) => (
          <DeleteRun
            record={r()}
            records={props.records}
            onDeleted={props.onDeleted}
            onClose={() => setDeleting(undefined)}
          />
        )}
      </Show>
    </>
  );
}
