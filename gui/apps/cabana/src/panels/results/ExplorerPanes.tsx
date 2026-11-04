import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { bridge, type RunRecord } from '../../lib/bridge-client.ts';
import { bridgeReady } from '../../lib/bridge-status.ts';
import { download } from '../../lib/export-figure.ts';
import type { ExplorerData } from '../../lib/explorer-data.ts';
import {
  sortRows,
  summarySentences,
  tableText,
  type SavedTable,
  type StatRow,
} from '../../lib/results-explorer.ts';
import { pageOf } from '../../lib/results-overview.ts';
import { HowTo } from '../AurocResults.tsx';

const PAGE_ROWS = 200;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The saved tables of a run: one at a time, sortable by column, copyable. */
export function TablesPane(props: { data: ExplorerData }): JSX.Element {
  const [pick, setPick] = createSignal(0);
  const [sort, setSort] = createSignal<{ col: number; desc: boolean } | undefined>();
  const [page, setPage] = createSignal(0);
  const [copied, setCopied] = createSignal('');
  const table = (): SavedTable | undefined => props.data.tables[pick()];
  const rows = createMemo(() => {
    const t = table();
    const s = sort();
    return t ? (s ? sortRows(t.rows, s.col, s.desc) : t.rows) : [];
  });
  const view = createMemo(() => pageOf(rows(), page(), PAGE_ROWS));
  const choose = (i: number) => {
    setPick(i);
    setSort(undefined);
    setPage(0);
  };
  const sortBy = (col: number) => {
    const s = sort();
    setSort({ col, desc: s?.col === col ? !s.desc : false });
    setPage(0);
  };
  const copy = async () => {
    const t = table();
    if (!t) return;
    try {
      await navigator.clipboard.writeText(tableText(t, rows()));
      setCopied('Copied');
    } catch {
      setCopied('Copy is not available in this browser.');
    }
  };
  return (
    <>
      <div class="cb-ex__bar">
        <h3>Tables</h3>
        <Show when={props.data.tables.length > 1}>
          <span class="cb-seg" role="group" aria-label="Table">
            <For each={props.data.tables}>
              {(t, i) => (
                <button
                  type="button"
                  classList={{ 'cb-seg__on': pick() === i() }}
                  aria-pressed={pick() === i()}
                  onClick={() => choose(i())}
                >
                  {t.name}
                </button>
              )}
            </For>
          </span>
        </Show>
        <span class="cb-ex__side">
          <Show when={copied()}>
            <span class="cb-muted" role="status">
              {copied()}
            </span>
          </Show>
          <button
            type="button"
            class="btn-secondary btn-small"
            disabled={!table()}
            onClick={() => void copy()}
          >
            Copy table
          </button>
        </span>
      </div>
      <Show when={props.data.tablesNote}>
        <p class="cb-ex__warn" role="status">
          {props.data.tablesNote}
        </p>
      </Show>
      <Show when={table()} fallback={<p class="cb-muted">No tables to show for this run.</p>}>
        {(t) => (
          <>
            <Show when={t().notes.length}>
              <details class="cb-ex__note">
                <summary>
                  What the values depend on ({t().notes.length} notes saved with the table)
                </summary>
                <For each={t().notes}>{(n) => <p>{n}</p>}</For>
              </details>
            </Show>
            <div class="cb-ex__scroll">
              <table class="cb-ex__t">
                <thead>
                  <tr>
                    <For each={t().columns}>
                      {(c, i) => (
                        <th
                          aria-sort={
                            sort()?.col === i()
                              ? sort()!.desc
                                ? 'descending'
                                : 'ascending'
                              : 'none'
                          }
                        >
                          <button
                            type="button"
                            title="Sort by this column"
                            onClick={() => sortBy(i())}
                          >
                            {c}
                            {sort()?.col === i() ? (sort()!.desc ? ' ▼' : ' ▲') : ''}
                          </button>
                        </th>
                      )}
                    </For>
                  </tr>
                </thead>
                <tbody>
                  <For each={view().items}>
                    {(r) => (
                      <tr>
                        <For each={r}>{(v) => <td>{v}</td>}</For>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
            <div class="cb-ex__bar">
              <span class="cb-muted">
                {view().total} {view().total === 1 ? 'row' : 'rows'}
              </span>
              <Show when={view().pages > 1}>
                <span class="cb-ex__side">
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
              </Show>
            </div>
          </>
        )}
      </Show>
    </>
  );
}

const fmt = (x: number) => String(+x.toPrecision(3));
const NOT_RECORDED = 'not recorded';
const below = (c: StatRow['pRaw'], alpha?: number) =>
  c ? `${c.below} of ${c.n} below ${alpha === undefined ? 'alpha' : alpha}` : 'none saved';

/** Statistics as saved: observed values, p-values, and the test they came from. */
export function StatisticsPane(props: { data: ExplorerData }): JSX.Element {
  return (
    <>
      <div class="cb-ex__bar">
        <h3>Statistics</h3>
        <HowTo title="Statistics">
          <p>
            Read from the saved run. Observed values are summarized by their count and smallest and
            largest value. P-values are counted against the saved alpha; no new test is run here.
          </p>
          <p>
            Unadjusted p-values are tested one at a time. Adjusted p-values are corrected as the
            correction column says. A blank field was not saved with the run.
          </p>
        </HowTo>
      </div>
      <Show when={props.data.statsNote}>
        <p class="cb-ex__warn" role="status">
          {props.data.statsNote}
        </p>
      </Show>
      <Show when={props.data.stats.length}>
        <div class="cb-ex__scroll">
          <table class="cb-ex__t">
            <thead>
              <tr>
                <th>Statistic</th>
                <th>n</th>
                <th>Observed (smallest to largest)</th>
                <th>Unit</th>
                <th>Unadjusted p</th>
                <th>Adjusted p</th>
                <th>Null</th>
                <th>Shuffles</th>
                <th>Alpha</th>
                <th>Correction</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.data.stats}>
                {(s) => (
                  <tr>
                    <td>{s.name}</td>
                    <td>
                      {s.n} {s.basis ?? 'values'}
                    </td>
                    <td class="cb-ex__num">
                      {s.range ? `${fmt(s.range[0])} to ${fmt(s.range[1])}` : 'none'}
                    </td>
                    <td>{s.unit || NOT_RECORDED}</td>
                    <td>{below(s.pRaw, s.test?.alpha)}</td>
                    <td>{below(s.pAdj, s.test?.alpha)}</td>
                    <td>{s.test?.nullMethod ?? (s.pRaw ? NOT_RECORDED : 'no test')}</td>
                    <td class="cb-ex__num">{s.test?.shuffles ?? (s.pRaw ? NOT_RECORDED : '')}</td>
                    <td class="cb-ex__num">{s.test?.alpha ?? (s.pRaw ? NOT_RECORDED : '')}</td>
                    <td>{s.test?.correction ?? (s.pRaw ? NOT_RECORDED : '')}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </>
  );
}

/** A factual summary written only from the saved numbers. */
export function SummaryPane(props: { record: RunRecord; data: ExplorerData }): JSX.Element {
  const sentences = () => summarySentences({ record: props.record, ...props.data.summary });
  const [note, setNote] = createSignal('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sentences().join('\n'));
      setNote('Copied');
    } catch {
      setNote('Copy is not available in this browser.');
    }
  };
  return (
    <>
      <div class="cb-ex__bar">
        <h3>Summary</h3>
        <span class="cb-ex__side">
          <Show when={note()}>
            <span class="cb-muted" role="status">
              {note()}
            </span>
          </Show>
          <button type="button" class="btn-secondary btn-small" onClick={() => void copy()}>
            Copy text
          </button>
        </span>
      </div>
      <p class="cb-ex__note">
        Written from the saved numbers only. It states values and counts and does not interpret
        them.
      </p>
      <div class="cb-ex__scroll cb-ex__sum">
        <For each={sentences()}>{(s) => <p>{s}</p>}</For>
      </div>
    </>
  );
}

/** The exports that need no plot: tables, settings, summary and the run bundle. */
export function ExportPane(props: { record: RunRecord; data: ExplorerData }): JSX.Element {
  const [error, setError] = createSignal('');
  const r = () => props.record;
  const attempt = async (work: () => Promise<void> | void) => {
    setError('');
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const base = () => `${r().analysis}-${r().run_id}`;
  const csvName = (t: SavedTable) => `${base()}-${t.name.replace(/\.csv$/, '')}.csv`;
  const asCsv = (t: SavedTable) => {
    const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    return [
      ...t.notes.map((n) => `# ${n}`),
      t.columns.map(q).join(','),
      ...t.rows.map((row) => row.map(q).join(',')),
    ].join('\n');
  };
  return (
    <>
      <h3>Export</h3>
      <div class="cb-ex__scroll cb-ex__exports">
        <p class="cb-ex__note">
          Figures are exported from each plot on its analysis page (the Export menu beside the plot
          title): SVG and PNG as shown, or the plot's numbers as CSV.
        </p>
        <For each={props.data.tables}>
          {(t) => (
            <button
              type="button"
              class="btn-secondary btn-small"
              onClick={() => download(csvName(t), asCsv(t), 'text/csv')}
            >
              Download {t.name} as CSV
            </button>
          )}
        </For>
        <Show when={!props.data.tables.length}>
          <p class="cb-muted">No tables to export for this run.</p>
        </Show>
        <button
          type="button"
          class="btn-secondary btn-small"
          onClick={() =>
            download(
              `${base()}-settings.json`,
              JSON.stringify(r().gui.settings, null, 2),
              'application/json',
            )
          }
        >
          Download settings as JSON
        </button>
        <button
          type="button"
          class="btn-secondary btn-small"
          onClick={() =>
            download(
              `${base()}-summary.txt`,
              summarySentences({ record: r(), ...props.data.summary }).join('\n'),
              'text/plain',
            )
          }
        >
          Download summary text
        </button>
        <Show when={r().engine === 'framework'}>
          <button
            type="button"
            class="btn-secondary btn-small"
            disabled={!bridgeReady()}
            onClick={() =>
              void attempt(async () =>
                download(`${base()}.zip`, await bridge.bundle(r().run_id), 'application/zip'),
              )
            }
          >
            Export run bundle
          </button>
          <Show when={!bridgeReady()}>
            <span class="cb-ex__why">The bundle needs the Python engine.</span>
          </Show>
        </Show>
        <Show when={error()}>
          <p class="cb-ro__err" role="alert">
            {error()}
          </p>
        </Show>
      </div>
    </>
  );
}
