import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { RunRecord } from '../../lib/bridge-client.ts';
import {
  analysisLabel,
  ANALYSIS_IDS,
  failureMessage,
  formatWhen,
  hasResults,
  historyRecords,
  MIN_HISTORY_ROWS,
  pageOf,
  targetOf,
} from '../../lib/results-overview.ts';
import type { AnalysisId } from '../../lib/runs.ts';
import { RunBadges } from './RunBanner.tsx';
import { OpenResult, RerunButton, ResultActions } from './ResultActions.tsx';

const ROW_PX = 44; // fixed row height (see results.css)
const HEAD_PX = 30;
const BAR_PX = 44;

/** Earlier executions of each analysis, newest first, 25 to a page. */
export function AnalysisHistory(props: {
  records: RunRecord[];
  onDeleted: (r: RunRecord) => void;
}): JSX.Element {
  const [filter, setFilter] = createSignal<AnalysisId | ''>('');
  const [page, setPage] = createSignal(0);
  // Rows that fit under the bar without scrolling: the page ends where the results workspace ends.
  const [rows, setRows] = createSignal(MIN_HISTORY_ROWS);
  let root!: HTMLDivElement;
  const fit = () => {
    const room =
      (root.closest('.cb-res')?.getBoundingClientRect().bottom ?? innerHeight) -
      root.getBoundingClientRect().top -
      BAR_PX -
      HEAD_PX;
    setRows(Math.max(MIN_HISTORY_ROWS, Math.floor(room / ROW_PX)));
  };
  onMount(() => {
    fit();
    requestAnimationFrame(fit);
    addEventListener('resize', fit);
    onCleanup(() => removeEventListener('resize', fit));
  });
  const all = createMemo(() => historyRecords(props.records, filter() || undefined));
  const view = createMemo(() => pageOf(all(), page(), rows()));
  return (
    <div class="cb-hist" ref={root}>
      <div class="cb-hist__bar">
        <label class="cb-muted">
          Analysis{' '}
          <select
            value={filter()}
            onChange={(e) => {
              setFilter(e.currentTarget.value as AnalysisId | '');
              setPage(0);
            }}
          >
            <option value="">All</option>
            <For each={ANALYSIS_IDS}>{(id) => <option value={id}>{analysisLabel(id)}</option>}</For>
          </select>
        </label>
        <span class="cb-muted">
          {view().total} earlier {view().total === 1 ? 'execution' : 'executions'}
        </span>
        <span class="cb-hist__pager">
          <button
            type="button"
            class="btn-secondary btn-small"
            disabled={view().page === 0}
            onClick={() => setPage(view().page - 1)}
          >
            Previous
          </button>
          <span class="cb-muted">
            Page {view().page + 1} of {view().pages}
          </span>
          <button
            type="button"
            class="btn-secondary btn-small"
            disabled={view().page >= view().pages - 1}
            onClick={() => setPage(view().page + 1)}
          >
            Next
          </button>
        </span>
      </div>
      <Show
        when={view().total}
        fallback={<p class="cb-muted cb-hist__empty">No earlier executions.</p>}
      >
        <div class="cb-hist__scroll">
          <table class="cb-hist__t">
            <thead>
              <tr>
                <th>Analysis</th>
                <th>Target</th>
                <th>Date</th>
                <th>Result</th>
                <th>
                  <span class="cb-sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <For each={view().items}>
                {(r) => (
                  <tr>
                    <td>{analysisLabel(r.analysis)}</td>
                    <td>
                      {hasResults(r) ? targetOf(r) : r.status === 'failed' ? failureMessage(r) : ''}
                    </td>
                    <td class="cb-muted">{formatWhen(r.created_utc)}</td>
                    <td>
                      <RunBadges record={r} saved={hasResults(r)} />
                    </td>
                    <td class="cb-hist__act">
                      <Show
                        when={hasResults(r) || r.status === 'running' || r.status === 'queued'}
                        fallback={<RerunButton record={r} />}
                      >
                        <OpenResult record={r} />
                      </Show>
                      <ResultActions record={r} onDeleted={props.onDeleted} />
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  );
}
