import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import type { RunRecord } from '../../lib/bridge-client.ts';
import type { ExplorerData } from '../../lib/explorer-data.ts';
import {
  sortRows,
  summarySentences,
  tableText,
  type SavedTable,
  type StatRow,
} from '../../lib/results-explorer.ts';
import { pageOf } from '../../lib/results-overview.ts';

const PAGE_ROWS = 200;

const rowsText = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'row' : 'rows'}`;

/**
 * The saved tables of a run: the list on the left, the selected table on the right with a filter
 * and sorting by column. Download is under Actions → Export.
 */
export function TablesPane(props: { data: ExplorerData }): JSX.Element {
  const [pick, setPick] = createSignal(0);
  const [sort, setSort] = createSignal<{ col: number; desc: boolean } | undefined>();
  const [page, setPage] = createSignal(0);
  const [filter, setFilter] = createSignal('');
  const [copied, setCopied] = createSignal('');
  const table = (): SavedTable | undefined => props.data.tables[pick()];
  const rows = createMemo(() => {
    const t = table();
    const s = sort();
    const q = filter().trim().toLowerCase();
    if (!t) return [];
    const kept = q ? t.rows.filter((r) => r.some((v) => v.toLowerCase().includes(q))) : t.rows;
    return s ? sortRows(kept, s.col, s.desc) : kept;
  });
  const view = createMemo(() => pageOf(rows(), page(), PAGE_ROWS));
  const choose = (i: number) => {
    setPick(i);
    setSort(undefined);
    setPage(0);
    setCopied('');
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
    <div class="cb-wt">
      <nav class="cb-rx__card cb-wt__list" aria-label="Saved tables">
        <For each={props.data.tables}>
          {(t, i) => (
            <button
              type="button"
              classList={{ 'cb-wt__item': true, 'cb-wt__item--on': pick() === i() }}
              aria-current={pick() === i() ? 'true' : undefined}
              onClick={() => choose(i())}
            >
              <span>{t.name}</span>
              <span class="cb-muted">{rowsText(t.rows.length)}</span>
            </button>
          )}
        </For>
        <Show when={!props.data.tables.length}>
          <p class="cb-muted cb-wt__none">No tables saved for this run.</p>
        </Show>
      </nav>
      <section class="cb-rx__card cb-wt__table" aria-label="Table">
        <Show when={props.data.tablesNote}>
          <p class="cb-ex__warn" role="status">
            {props.data.tablesNote}
          </p>
        </Show>
        <Show when={table()} fallback={<p class="cb-muted cb-wt__none">No table to show.</p>}>
          {(t) => (
            <>
              <div class="cb-ex__bar">
                <h3>{t().name}</h3>
                <span class="cb-muted cb-wt__cols">
                  {rowsText(t().rows.length)} · {t().columns.join(', ')}
                </span>
                <span class="cb-ex__side">
                  <Show when={copied()}>
                    <span class="cb-muted" role="status">
                      {copied()}
                    </span>
                  </Show>
                  <button type="button" class="btn-secondary btn-small" onClick={() => void copy()}>
                    Copy table
                  </button>
                  <input
                    type="search"
                    class="cb-wt__filter"
                    placeholder="Filter rows"
                    aria-label="Filter rows"
                    value={filter()}
                    onInput={(e) => {
                      setFilter(e.currentTarget.value);
                      setPage(0);
                    }}
                  />
                </span>
              </div>
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
                  {rowsText(view().total)}
                  {filter().trim() ? ' match the filter' : ''}
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
      </section>
    </div>
  );
}

const fmt = (x: number) => String(+x.toPrecision(3));
const NOT_RECORDED = 'not recorded';

/** "44 of 180 cells with p below 0.05": a count of saved p-values against the saved alpha. */
function pText(s: StatRow): string {
  const c = s.pAdj ?? s.pRaw;
  if (!c) return `${s.n} ${s.basis ?? 'values'}`;
  const alpha = s.test?.alpha === undefined ? 'alpha' : String(s.test.alpha);
  return `${c.below} of ${c.n} ${s.basis ?? 'values'} with ${s.pAdj ? 'adjusted ' : ''}p below ${alpha}`;
}

/** The shuffle test behind a statistic, as saved; a field the run did not save says so. */
function testText(s: StatRow): string | undefined {
  if (!s.pRaw && !s.pAdj) return undefined;
  const t = s.test;
  const correction = t?.correction
    ? t.correction === 'none'
      ? 'no correction'
      : /correction|no adjusted/.test(t.correction)
        ? t.correction
        : `${t.correction} correction`
    : `correction ${NOT_RECORDED}`;
  return [
    `${t?.nullMethod ?? NOT_RECORDED} null`,
    `${t?.shuffles ?? NOT_RECORDED} shuffles`,
    correction,
  ].join(' · ');
}

/** One card per statistic of the saved run: the count of p-values below alpha, then what it rests on. */
function StatCard(props: { s: StatRow }): JSX.Element {
  const s = () => props.s;
  return (
    <article class="cb-rx__card cb-wst__card">
      <div class="sc">{s().name}</div>
      <b class="cb-wst__big">{pText(s())}</b>
      <p class="cb-muted">
        {s().n} {s().basis ?? 'values'}
        {s().unit ? ` · ${s().unit}` : ''}
        {s().range ? ` · observed ${fmt(s().range![0])} to ${fmt(s().range![1])}` : ''}
      </p>
      <Show when={testText(s())}>
        <p class="cb-muted">{testText(s())}</p>
      </Show>
    </article>
  );
}

/** A factual description of the run written only from the saved numbers, with Copy as text. */
export function MethodsCard(props: { record: RunRecord; data: ExplorerData }): JSX.Element {
  const sentences = () => summarySentences({ record: props.record, ...props.data.summary });
  const [note, setNote] = createSignal('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sentences().join(' '));
      setNote('Copied');
    } catch {
      setNote('Copy is not available in this browser.');
    }
  };
  return (
    <section class="cb-rx__card cb-wst__methods" aria-label="Methods">
      <div class="cb-ex__bar">
        <h3>Methods</h3>
        <span class="cb-ex__side">
          <Show when={note()}>
            <span class="cb-muted" role="status">
              {note()}
            </span>
          </Show>
          <button type="button" class="cb-link" onClick={() => void copy()}>
            Copy as text
          </button>
        </span>
      </div>
      <div class="cb-ex__scroll cb-ex__sum">
        <p class="cb-ex__note">
          Written from the saved numbers only. It states values and counts and does not interpret
          them.
        </p>
        <p>{sentences().join(' ')}</p>
      </div>
    </section>
  );
}

/** Statistics as saved: one card per test, then the methods text to copy. */
export function StatisticsPane(props: { record: RunRecord; data: ExplorerData }): JSX.Element {
  return (
    <div class="cb-wst">
      <Show when={props.data.statsNote}>
        <p class="cb-ex__warn" role="status">
          {props.data.statsNote}
        </p>
      </Show>
      <div class="cb-wst__cards">
        <For each={props.data.stats}>{(s) => <StatCard s={s} />}</For>
      </div>
      <MethodsCard record={props.record} data={props.data} />
    </div>
  );
}
