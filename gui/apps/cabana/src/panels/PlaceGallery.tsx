import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from 'solid-js';
import { HowToRead } from './parts.tsx';
import { OVERALL } from '../lib/place-outcome.ts';
import { SORTS } from '../lib/place-table.ts';
import { displayMap, gradientCss, maxOf, placeDisplay } from '../lib/place-display.ts';
import { InfoTip } from './InfoTip.tsx';
import { num, outcomeClass, type ResultsCtx } from './place-ctx.ts';
import { RateMap } from './RateMap.tsx';

// Kept outside the gallery so the page and scale survive a visit to the inspector or the settings.
// The page is kept as the index of its first card, so it survives a change in page size.
const [start, setStart] = createSignal(0);
const [perCell, setPerCell] = createSignal(true);

const GAP = 8;
const MIN_MAP = 84; // narrowest map, in px, that still reads
const CARD_EXTRA = 104; // card padding, title row and the peak-rate line, in px

/**
 * How many cards fit the space without scrolling, and how wide their maps are. For 1 to 6 rows,
 * fits as many columns of maps at least MIN_MAP wide as the width allows, and keeps the layout
 * that shows the most maps (the larger maps when tied).
 */
function fit(w: number, h: number, aspect: number): { cols: number; rows: number; map: number } {
  let best = { cols: 1, rows: 1, map: MIN_MAP };
  const cols = Math.max(1, Math.floor((w + GAP) / (MIN_MAP + 18 + GAP)));
  for (let rows = 1; rows <= 6; rows++) {
    const byHeight = ((h - GAP * (rows - 1)) / rows - CARD_EXTRA) * aspect;
    const map = Math.floor(Math.min(byHeight, (w + GAP) / cols - 18 - GAP, 320));
    if (map < MIN_MAP) break;
    const n = cols * rows;
    if (n > best.cols * best.rows || (n === best.cols * best.rows && map > best.map))
      best = { cols, rows, map };
  }
  return best;
}

/** Whole-session maps in a grid, as many as fit, a page at a time. Click a card to select the cell. */
export function PlaceGallery(props: { ctx: ResultsCtx }): JSX.Element {
  const c = () => props.ctx;
  const r = () => c().out.result;
  const { nx, ny, open, bin } = props.ctx.out.data.grid;
  const arenaCm = props.ctx.out.arenaCm;
  const mapProps = { nx, ny, open, bin, arenaCm };
  const [box, setBox] = createSignal({ w: 600, h: 420 });
  const layout = createMemo(() => fit(box().w, box().h, arenaCm[0] / arenaCm[1]));
  const perPage = () => layout().cols * layout().rows;
  const pages = () => Math.max(1, Math.ceil(c().list().length / perPage()));
  // A new selection, filter or sort turns to the selected cell's page (the first page if it is hidden).
  createEffect(
    on([c().list, c().selected], () => setStart(Math.max(0, c().position())), { defer: true }),
  );
  // A new page size keeps the selected cell in view if it was on the page.
  createEffect(
    on(
      perPage,
      (_, old) => {
        const p = c().position();
        const from = old ? Math.floor(start() / old) * old : 0;
        if (old && p >= from && p < from + old) setStart(p);
      },
      { defer: true },
    ),
  );
  const here = () => Math.min(Math.floor(start() / perPage()), pages() - 1);
  const shown = () =>
    c()
      .list()
      .slice(here() * perPage(), (here() + 1) * perPage());
  const slice = (k: number) => r().rate.subarray(k * r().nStates, (k + 1) * r().nStates);
  // The top of the color scale when every map shares one: the highest bin of any cell.
  const overallMax = createMemo(() => {
    let m = 0;
    for (const v of r().rate) if (Number.isFinite(v) && v > m) m = v;
    return m;
  });
  const first = () => (c().list().length ? here() * perPage() + 1 : 0);
  let grid!: HTMLDivElement;
  onMount(() => {
    const ro = new ResizeObserver(([e]) =>
      setBox({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    ro.observe(grid);
    onCleanup(() => ro.disconnect());
  });

  return (
    <div class="cb-gal">
      <div class="cb-gallerybar">
        <label class="cb-sortpick">
          Sort by
          <select
            value={c().sort()}
            onChange={(e) => {
              const s = SORTS.find((x) => x.key === e.currentTarget.value)!;
              c().setSort(s.key, s.desc);
            }}
          >
            <For each={SORTS}>{(s) => <option value={s.key}>{s.label}</option>}</For>
          </select>
          <button
            type="button"
            class="cb-link"
            aria-label={
              c().desc()
                ? 'High to low; switch to low to high'
                : 'Low to high; switch to high to low'
            }
            onClick={() => c().setSort(c().sort(), !c().desc())}
          >
            {c().desc() ? '↓' : '↑'}
          </button>
        </label>
        <span class="cb-sortpick">
          Color scale
          <span class="cb-seg" role="group" aria-label="Color scale">
            <button
              classList={{ 'cb-seg__on': perCell() }}
              aria-pressed={perCell()}
              onClick={() => setPerCell(true)}
            >
              Per cell
            </button>
            <button
              classList={{ 'cb-seg__on': !perCell() }}
              aria-pressed={!perCell()}
              onClick={() => setPerCell(false)}
            >
              Shared
            </button>
          </span>
          <InfoTip label="About the color scale">
            {perCell()
              ? 'Each map is scaled to its own peak. Compare spatial patterns across cells; use the listed peak rates to compare activity levels.'
              : 'All maps share one scale, from 0 to the highest rate of any cell. Cells with low rates look dim.'}
          </InfoTip>
        </span>
      </div>

      <div
        class="cb-gallery"
        ref={grid}
        style={{ 'grid-template-columns': `repeat(${layout().cols}, minmax(0, 1fr))` }}
      >
        <For each={shown()}>
          {(row) => {
            const m = () => displayMap(slice(row.i), [ny, nx]);
            const on = () => row.i === c().selected();
            return (
              <button
                type="button"
                class="cb-gcard"
                classList={{ 'cb-gcard--on': on() }}
                aria-pressed={on()}
                aria-label={`Cell ${row.id + 1}, ${OVERALL[row.overall].label}`}
                onClick={() => c().pick(row.i)}
              >
                <span class="cb-gcard__head">
                  <strong>Cell {row.id + 1}</strong>
                  <span class={`cb-badge ${outcomeClass(row.overall)}`}>
                    <span aria-hidden="true">{OVERALL[row.overall].icon}</span>{' '}
                    {OVERALL[row.overall].label}
                  </span>
                </span>
                <RateMap
                  values={m()}
                  max={perCell() ? maxOf(m()) : overallMax()}
                  size={layout().map}
                  {...mapProps}
                />
                <span class="cb-gcard__stats">Peak {num(r().peak[row.i], 1)} events/s</span>
              </button>
            );
          }}
        </For>
        <Show when={!c().list().length}>
          <div class="cb-empty">No cells match this filter or search.</div>
        </Show>
      </div>

      <div class="cb-pager">
        <span class="cb-gallerybar__legend" role="img" aria-label="Color scale">
          Event rate <span>0</span>
          <span
            class="cb-legend__bar cb-legend__bar--sm"
            style={{ background: gradientCss('right') }}
          />
          <span>{perCell() ? "each cell's peak" : `${num(overallMax(), 1)} events/s`}</span>
          <i class="cb-grey" /> Under minimum time
        </span>
        <HowToRead>
          <p>
            Each card is one cell’s whole-session event-rate map, seen from above: events divided by
            the time spent in each bin, then smoothed. With <em>Per cell</em>, each map runs from 0
            to that cell’s own peak, so compare shapes, not brightness; with <em>Shared</em>, all
            maps use one scale up to the highest rate of any cell. Grey bins were visited too little
            to estimate a rate. Under each map is the cell’s peak rate. The badge shows which tests
            were significant; the p-values are in the cell panel. Click a card to show the cell
            beside the gallery.
          </p>
          <Show when={placeDisplay.sigma > 0 || placeDisplay.style === 'smooth'}>
            <p>Maps are drawn with extra smoothing or interpolation. Display only.</p>
          </Show>
        </HowToRead>
        <span class="cb-pager__btns">
          <span class="cb-muted">
            {first()}–{Math.min(c().list().length, (here() + 1) * perPage())} of {c().list().length}
          </span>
          <button
            class="btn-secondary btn-small"
            disabled={here() === 0}
            onClick={() => setStart((here() - 1) * perPage())}
          >
            ‹ Previous
          </button>
          <button
            class="btn-secondary btn-small"
            disabled={here() >= pages() - 1}
            onClick={() => setStart((here() + 1) * perPage())}
          >
            Next ›
          </button>
        </span>
      </div>
    </div>
  );
}
