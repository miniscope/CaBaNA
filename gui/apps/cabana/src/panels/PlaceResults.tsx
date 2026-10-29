import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from 'solid-js';
import { OVERALL, OVERALL_ORDER } from '../lib/place-outcome.ts';
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
import { MapAppearance } from './MapAppearance.tsx';
import { PlaceCellPanel } from './PlaceCellPanel.tsx';
import { PlaceGallery } from './PlaceGallery.tsx';
import { PlaceInspector } from './PlaceInspector.tsx';
import { PlaceIntro, PlaceMethodText } from './PlaceMethodText.tsx';
import { PlacePopulation } from './PlacePopulation.tsx';
import { PlaceRunDetails } from './PlaceRunDetails.tsx';
import { FILTERS, type ResultsCtx } from './place-ctx.ts';
import { fitToWindow } from './QcPanel.tsx';

// Outcome names short enough for the summary bar; the full names are in each segment's title.
const SHORT = {
  both: 'Both tests',
  info: 'Information only',
  stab: 'Stability only',
  neither: 'Neither test',
  cannot: 'Not evaluated',
};

type View = 'gallery' | 'population' | 'inspector';

// Kept outside the page so the view, filter, sort and folds survive a visit to the settings.
const [view, setView] = createSignal<View>('gallery');
const [filter, setFilter] = createSignal<Filter>('all');
const [query, setQuery] = createSignal('');
const [sortKey, setSortKey] = createSignal<SortKey>('information');
const [desc, setDesc] = createSignal(true);
const [outlines, setOutlines] = createSignal(true);
const [method, setMethod] = createSignal(false);
const [panelOpen, setPanelOpen] = createSignal(true);

/**
 * The page after a run: a summary that filters, then the map gallery with the selected cell beside it.
 * The full inspector and the population plots replace the gallery on request, sharing its filter,
 * sort and selected cell.
 * `changes` lists the settings that differ from this run, so the page can say its results are older.
 */
export function PlaceResults(props: {
  out: PlaceOutcome;
  changes: string[];
  onEdit: () => void;
}): JSX.Element {
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
    pick: (i) => {
      selectCell(ids()[i]);
      setPanelOpen(true);
    },
    step,
    openInspector: () => setView('inspector'),
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
  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));
  const total = () => rows().length;

  return (
    <div class="cb-results" ref={root}>
      <div class="cb-resbar">
        <h2 class="cb-restitle">Place cell results</h2>
        <span class="cb-muted">
          <i class="cb-dot cb-dot--ok" /> Run complete · {rows().length} cells analyzed
        </span>
        <Show when={props.changes.length}>
          <span class="cb-pill cb-pill--warn">Settings differ from this run</span>
        </Show>
        <span class="cb-resbar__sp" />
        <button
          ref={detailsButton}
          class="cb-link"
          aria-haspopup="dialog"
          aria-expanded={drawer()}
          onClick={() => setDrawer(true)}
        >
          Run details ›
        </button>
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
        <div class="cb-sumbox__count">
          <span class="cb-sumbox__n">
            {counts().both} / {total()}
          </span>{' '}
          meet place-cell criteria
          <div class="cb-muted">
            Significant spatial information and stability, p &lt; {alpha()}{' '}
            <button class="cb-link" aria-expanded={method()} onClick={() => setMethod(!method())}>
              Method note {method() ? '▴' : '▾'}
            </button>
          </div>
        </div>
        <div class="cb-obar" role="group" aria-label="Filter cells by test outcome">
          <For each={OVERALL_ORDER.filter((k) => counts()[k] > 0)}>
            {(k) => (
              <button
                class={`cb-obar__seg cb-obar__seg--${k}`}
                classList={{ 'cb-obar__seg--on': filter() === k }}
                style={{ 'flex-grow': counts()[k] }}
                aria-pressed={filter() === k}
                title={`${OVERALL[k].label}. ${filter() === k ? 'Click to show all cells.' : 'Click to show only these cells.'}`}
                onClick={() => setFilter(filter() === k ? 'all' : k)}
              >
                <span class="cb-obar__n">{counts()[k]}</span>
                <span class="cb-obar__label">
                  <span aria-hidden="true">{OVERALL[k].icon}</span> {SHORT[k]}
                </span>
              </button>
            )}
          </For>
        </div>
      </div>
      <Show when={method()}>
        <div class="cb-notebox cb-method cb-muted">
          <PlaceIntro />
          <PlaceMethodText interpretation notEvaluated={counts().cannot > 0} />
          <Show when={counts().cannot > 0}>
            <p>
              “{OVERALL.cannot.label}” means a test had no defined result (for example a silent
              cell); it is not the same as failing.
            </p>
          </Show>
        </div>
      </Show>

      <div class="cb-resview">
        <Show
          when={view() !== 'inspector'}
          fallback={
            <div class="cb-resview__bar">
              <button class="btn-secondary btn-small" onClick={() => setView('gallery')}>
                ‹ Back to gallery
              </button>
              <span class="cb-muted">Full cell inspector</span>
            </div>
          }
        >
          <div class="cb-resview__bar">
            <h3>Browse cells</h3>
            <span class="cb-seg" role="group" aria-label="Results view">
              <button
                classList={{ 'cb-seg__on': view() === 'gallery' }}
                aria-pressed={view() === 'gallery'}
                onClick={() => setView('gallery')}
              >
                Maps
              </button>
              <button
                classList={{ 'cb-seg__on': view() === 'population' }}
                aria-pressed={view() === 'population'}
                onClick={() => setView('population')}
              >
                Population plots
              </button>
            </span>
            <label class="cb-sortpick">
              Show
              <select
                value={ctx.filter()}
                onChange={(e) =>
                  ctx.setFilter(e.currentTarget.value as ReturnType<ResultsCtx['filter']>)
                }
              >
                <For each={FILTERS}>
                  {([k, label]) => (
                    <option value={k}>
                      {label} ({k === 'all' ? ctx.rows().length : ctx.counts()[k]})
                    </option>
                  )}
                </For>
              </select>
            </label>
            <input
              class="cb-search"
              type="search"
              inputmode="numeric"
              placeholder="Find cell…"
              aria-label="Find cell number"
              value={ctx.query()}
              onInput={(e) => ctx.setQuery(e.currentTarget.value.replace(/\D/g, ''))}
            />
            <MapAppearance />
          </div>
        </Show>
        <div class="cb-resview__body">
          <Show when={view() === 'gallery'}>
            <div class="cb-galwrap" classList={{ 'cb-galwrap--panel': panelOpen() }}>
              <PlaceGallery ctx={ctx} />
              <Show when={panelOpen()}>
                <PlaceCellPanel
                  ctx={ctx}
                  onClose={() => setPanelOpen(false)}
                  onInspector={() => setView('inspector')}
                />
              </Show>
            </div>
          </Show>
          <Show when={view() === 'inspector'}>
            <PlaceInspector ctx={ctx} outlines={outlines()} setOutlines={setOutlines} />
          </Show>
          <Show when={view() === 'population'}>
            <PlacePopulation ctx={ctx} />
          </Show>
        </div>
      </div>
      <div class="cb-place-foot cb-muted">
        Click a map to inspect a cell. The selected cell, filter, sort and page are kept when you
        open the inspector, the population plots or the settings.
      </div>

      <Show when={drawer()}>
        <PlaceRunDetails out={out()} onClose={closeDrawer} />
      </Show>
    </div>
  );
}
