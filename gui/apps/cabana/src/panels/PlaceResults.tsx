import { createEffect, createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { OVERALL } from '../lib/place-outcome.ts';
import { downloadText, placeCsv } from '../lib/place-export.ts';
import { cancelPlaceRun, placeStatus, runPlaceCells, type PlaceOutcome } from '../lib/place-run.ts';
import {
  buildRows,
  countOutcomes,
  listRows,
  type Filter,
  type SortKey,
} from '../lib/place-table.ts';
import { cell, selectCell } from '../lib/store.ts';
import { PlaceGallery } from './PlaceGallery.tsx';
import { PlaceInspector } from './PlaceInspector.tsx';
import { PlaceIntro, PlaceMethodText } from './PlaceMethodText.tsx';
import { PlacePopulation } from './PlacePopulation.tsx';
import { PlaceRunDetails } from './PlaceRunDetails.tsx';
import { FILTERS, type ResultsCtx } from './place-ctx.ts';

type Tab = 'inspector' | 'gallery' | 'population';
const TABS: [Tab, string][] = [
  ['inspector', 'Cell inspector'],
  ['gallery', 'Map gallery'],
  ['population', 'Population overview'],
];

/**
 * The page after a run: a summary, then three views of the same cells (inspector, gallery, population),
 * with the filter, the sort, and the selected cell shared between them.
 * `changes` lists the settings that differ from this run, so the page can say its results are older.
 */
export function PlaceResults(props: {
  out: PlaceOutcome;
  changes: string[];
  onEdit: () => void;
}): JSX.Element {
  const [tab, setTab] = createSignal<Tab>('inspector');
  const [filter, setFilter] = createSignal<Filter>('all');
  const [query, setQuery] = createSignal('');
  const [sortKey, setSortKey] = createSignal<SortKey>('information');
  const [desc, setDesc] = createSignal(true);
  const [outlines, setOutlines] = createSignal(true);
  const [method, setMethod] = createSignal(false);
  const [drawer, setDrawer] = createSignal(false);
  let detailsButton: HTMLButtonElement | undefined;

  const out = () => props.out;
  const alpha = () => out().settings.alpha;
  const ids = () => out().data.cellIds;
  const rows = createMemo(() => buildRows(out()));
  const counts = createMemo(() => countOutcomes(rows()));
  const list = createMemo(() =>
    listRows(rows(), out(), { filter: filter(), query: query(), sort: sortKey(), desc: desc() }),
  );
  const selected = () => ids().indexOf(cell());
  createEffect(() => {
    if (selected() < 0 && ids().length) selectCell(ids()[0]); // a rejected or missing cell: start at the first
  });
  const position = () => list().findIndex((row) => row.id === cell());
  const step = (d: 1 | -1) => {
    const l = list();
    if (!l.length) return;
    const p = position();
    selectCell(
      l[p < 0 ? (d > 0 ? 0 : l.length - 1) : Math.min(l.length - 1, Math.max(0, p + d))].id,
    );
  };

  const ctx: ResultsCtx = {
    get out() {
      return props.out;
    },
    rows,
    list,
    counts,
    filter,
    setFilter,
    query,
    setQuery,
    sort: sortKey,
    desc,
    setSort: (key, d) => {
      setSortKey(key);
      setDesc(d);
    },
    selected,
    position,
    pick: (i) => selectCell(ids()[i]),
    step,
    openInspector: () => setTab('inspector'),
  };

  const running = () => {
    const s = placeStatus();
    return s.kind === 'running' ? s : undefined;
  };
  const failed = () => {
    const s = placeStatus();
    return s.kind === 'error' ? s.message : undefined;
  };
  const closeDrawer = () => {
    setDrawer(false);
    detailsButton?.focus();
  };
  const onTabKey = (e: KeyboardEvent) => {
    const k = TABS.findIndex(([t]) => t === tab());
    const to = e.key === 'ArrowRight' ? k + 1 : e.key === 'ArrowLeft' ? k - 1 : undefined;
    if (to === undefined) return;
    e.preventDefault();
    const [next] = TABS[(to + TABS.length) % TABS.length];
    setTab(next);
    document.getElementById(`pc-tab-${next}`)?.focus();
  };

  return (
    <div class="cb-results">
      <div class="cb-resbar">
        <h2 class="cb-restitle">Place cell results</h2>
        <span class="cb-muted">
          <i class="cb-dot cb-dot--ok" /> Run complete · {rows().length} cells analyzed
        </span>
        <Show when={props.changes.length}>
          <span class="cb-pill cb-pill--warn">Settings differ from this run</span>
        </Show>
        <span class="cb-resbar__sp" />
        <button class="btn-secondary btn-small" onClick={() => props.onEdit()}>
          Edit settings
        </button>
        <button
          class="btn-primary btn-small"
          onClick={() => downloadText('place_cells.csv', placeCsv(out()), 'text/csv')}
        >
          Export results
        </button>
      </div>

      <Show when={props.changes.length}>
        <div class="cb-note" role="status">
          <strong>These results use the previous settings.</strong> Changed since the run:{' '}
          {props.changes.join(', ')}.{' '}
          <Show
            when={!running()}
            fallback={
              <>
                {running()!.step} ({running()!.done} of {running()!.total}){' '}
                <button class="btn-secondary btn-small" onClick={cancelPlaceRun}>
                  Cancel
                </button>
              </>
            }
          >
            <button class="btn-secondary btn-small" onClick={() => props.onEdit()}>
              Edit settings
            </button>{' '}
            <button class="btn-primary btn-small" onClick={() => void runPlaceCells()}>
              Run again
            </button>
          </Show>
        </div>
      </Show>
      <Show when={failed()}>
        <div class="cb-note">{failed()}</div>
      </Show>

      <div class="cb-sumbox">
        <div>
          <div>
            <span class="cb-sumbox__n">
              {counts().both} of {rows().length}
            </span>{' '}
            cells meet place-cell criteria
          </div>
          <div class="cb-muted">Both tests require p &lt; {alpha()}</div>
        </div>
        <span class="cb-resbar__sp" />
        <button class="cb-link" aria-expanded={method()} onClick={() => setMethod(!method())}>
          Method note {method() ? '▴' : '▾'}
        </button>
        <button
          ref={detailsButton}
          class="btn-secondary btn-small"
          aria-haspopup="dialog"
          aria-expanded={drawer()}
          onClick={() => setDrawer(true)}
        >
          Run details ›
        </button>
      </div>
      <Show when={method()}>
        <div class="cb-notebox cb-method cb-muted">
          <PlaceIntro />
          <PlaceMethodText interpretation notEvaluated={counts().cannot > 0} />
        </div>
      </Show>

      <div class="cb-tabs" role="tablist" aria-label="Results views" onKeyDown={onTabKey}>
        <For each={TABS}>
          {([id, label]) => (
            <button
              id={`pc-tab-${id}`}
              role="tab"
              aria-selected={tab() === id}
              aria-controls="pc-panel"
              tabindex={tab() === id ? 0 : -1}
              classList={{ 'cb-tab--on': tab() === id }}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          )}
        </For>
      </div>

      <div id="pc-panel" role="tabpanel" aria-labelledby={`pc-tab-${tab()}`}>
        <Show when={tab() !== 'population'}>
          <div class="cb-filterhead">Significant tests</div>
          <div class="cb-filters" role="group" aria-label="Filter cells by significant tests">
            <For each={FILTERS}>
              {([k, label]) => (
                <button
                  classList={{ 'cb-filter--on': filter() === k }}
                  aria-pressed={filter() === k}
                  onClick={() => setFilter(k)}
                >
                  {label}{' '}
                  <span class="cb-chip__n">{k === 'all' ? rows().length : counts()[k]}</span>
                </button>
              )}
            </For>
          </div>
          <p class="cb-muted">
            Cells must have significant spatial information and stability to meet place-cell
            criteria.
            <Show when={counts().cannot > 0}>
              {' '}
              “{OVERALL.cannot.label}” means a test had no defined result (for example a silent
              cell); it is not the same as failing.
            </Show>
          </p>
        </Show>
        <Show when={tab() === 'inspector'}>
          <PlaceInspector ctx={ctx} outlines={outlines()} setOutlines={setOutlines} />
        </Show>
        <Show when={tab() === 'gallery'}>
          <PlaceGallery ctx={ctx} />
        </Show>
        <Show when={tab() === 'population'}>
          <PlacePopulation ctx={ctx} />
        </Show>
      </div>

      <Show when={drawer()}>
        <PlaceRunDetails out={out()} onClose={closeDrawer} />
      </Show>
    </div>
  );
}
