import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from 'solid-js';
import { HowToRead } from './parts.tsx';
import { OVERALL } from '../lib/place-outcome.ts';
import { SORTS } from '../lib/place-table.ts';
import { displayMap, gradientCss, maxOf, placeDisplay } from '../lib/place-display.ts';
import { MapAppearance } from './MapAppearance.tsx';
import { num, outcomeClass, p3, type ResultsCtx } from './place-ctx.ts';
import { RateMap } from './RateMap.tsx';

const PER_PAGE = 12;

/** Whole-session maps in a grid, a page at a time. Click a card to select the cell. */
export function PlaceGallery(props: { ctx: ResultsCtx }): JSX.Element {
  const c = () => props.ctx;
  const r = () => c().out.result;
  const { nx, ny, open, bin } = props.ctx.out.data.grid;
  const mapProps = { nx, ny, open, bin, arenaCm: props.ctx.out.arenaCm };
  const [perCell, setPerCell] = createSignal(true);
  // Open on the page that holds the selected cell.
  const [page, setPage] = createSignal(Math.max(0, Math.floor(props.ctx.position() / PER_PAGE)));
  const pages = () => Math.max(1, Math.ceil(c().list().length / PER_PAGE));
  createEffect(
    on(
      () => [c().filter(), c().query(), c().sort(), c().desc()],
      () => setPage(0),
      { defer: true },
    ),
  );
  const here = () => Math.min(page(), pages() - 1);
  const shown = () =>
    c()
      .list()
      .slice(here() * PER_PAGE, (here() + 1) * PER_PAGE);
  const slice = (k: number) => r().rate.subarray(k * r().nStates, (k + 1) * r().nStates);
  // The top of the color scale when every map shares one: the highest bin of any cell.
  const overallMax = createMemo(() => {
    let m = 0;
    for (const v of r().rate) if (Number.isFinite(v) && v > m) m = v;
    return m;
  });
  const first = () => (c().list().length ? here() * PER_PAGE + 1 : 0);

  return (
    <>
      <HowToRead>
        <p>
          Each card is one cell’s whole-session event-rate map, seen from above, with the p-values of its two tests. Colors follow
          the scale chosen under map appearance; grey bins were visited too little to estimate a rate. The badge shows whether the
          cell passed both tests. Select a card to open the cell in the inspector.
        </p>
      </HowToRead>
      <div class="cb-gallerybar">
        <strong>{c().rows().length} cells</strong>
        <input
          class="cb-search"
          type="search"
          inputmode="numeric"
          placeholder="Find cell…"
          aria-label="Find cell number"
          value={c().query()}
          onInput={(e) => c().setQuery(e.currentTarget.value.replace(/\D/g, ''))}
        />
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
        <label class="cb-check-inline">
          <input
            type="checkbox"
            role="switch"
            checked={perCell()}
            onChange={(e) => setPerCell(e.currentTarget.checked)}
          />
          Scale colors per cell
        </label>
        <MapAppearance />
        <span class="cb-gallerybar__legend" role="img" aria-label="Color scale">
          <span>0</span>
          <span class="cb-legend__bar" style={{ background: gradientCss('right') }} />
          <span>{perCell() ? '1 (own peak)' : `${num(overallMax(), 1)} events/s`}</span>
          <i class="cb-grey" /> Below minimum sampling time
        </span>
      </div>
      <p class="cb-muted">
        {perCell()
          ? 'Each map is scaled to its own peak. Compare spatial patterns across cells; use the listed peak rates to compare activity levels.'
          : 'All maps share one scale, from 0 to the highest rate of any cell. Cells with low rates look dim.'}
      </p>
      <div class="cb-gallery">
        <For each={shown()}>
          {(row) => {
            const m = () => displayMap(slice(row.i), [ny, nx]);
            const on = () => row.i === c().selected();
            return (
              <div
                class="cb-gcard"
                classList={{ 'cb-gcard--on': on() }}
                onClick={() => c().pick(row.i)}
              >
                <div class="cb-gcard__head">
                  <button
                    type="button"
                    class="cb-gcard__pick"
                    aria-pressed={on()}
                    aria-label={`Select cell ${row.id + 1}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      c().pick(row.i);
                    }}
                  >
                    Cell {row.id + 1}
                  </button>
                  <Show when={on()}>
                    <button type="button" class="cb-link" onClick={() => c().openInspector()}>
                      Open in cell inspector ↗
                    </button>
                  </Show>
                </div>
                <span class={`cb-badge ${outcomeClass(row.overall)}`}>
                  <span aria-hidden="true">{OVERALL[row.overall].icon}</span>{' '}
                  {OVERALL[row.overall].label}
                </span>
                <RateMap
                  values={m()}
                  max={perCell() ? maxOf(m()) : overallMax()}
                  size={220}
                  {...mapProps}
                />
                <div class="cb-gcard__stats">
                  <span>Information p {p3(r().pInformation[row.i])}</span>
                  <span>Stability p {p3(r().pStability[row.i])}</span>
                  <span>Peak {num(r().peak[row.i], 1)} events/s</span>
                </div>
              </div>
            );
          }}
        </For>
      </div>
      <Show when={!c().list().length}>
        <div class="cb-empty">No cells match this filter or search.</div>
      </Show>
      <div class="cb-pager">
        <span class="cb-muted">
          Showing {first()}–{Math.min(c().list().length, (here() + 1) * PER_PAGE)} of{' '}
          {c().list().length}
          {c().list().length !== c().rows().length ? ` (${c().rows().length} in the run)` : ''}
        </span>
        <span class="cb-pager__btns">
          <button
            class="btn-secondary btn-small"
            disabled={here() === 0}
            onClick={() => setPage(here() - 1)}
          >
            ‹ Previous
          </button>
          <span class="cb-muted">
            Page {here() + 1} of {pages()}
          </span>
          <button
            class="btn-secondary btn-small"
            disabled={here() >= pages() - 1}
            onClick={() => setPage(here() + 1)}
          >
            Next ›
          </button>
        </span>
      </div>
      <Show when={placeDisplay.sigma > 0 || placeDisplay.style === 'smooth'}>
        <p class="cb-muted">Maps are drawn with extra smoothing or interpolation. Display only.</p>
      </Show>
    </>
  );
}
