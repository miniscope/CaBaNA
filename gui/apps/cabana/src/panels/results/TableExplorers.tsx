// Explorer parts for auROC and Place cells, drawn from the tables their runs save.

import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import type { ExplorerData } from '../../lib/explorer-data.ts';
import { aurocColor } from '../../lib/auroc-view.ts';
import { OVERALL, type Overall } from '../../lib/place-outcome.ts';
import {
  aurocOrder,
  outcomeCounts,
  responseCounts,
  type AurocModel,
  type PlaceCell,
} from '../../lib/results-saved.ts';
import type { PlaceMaps } from '../../lib/results-framework.ts';
import { RateMap } from '../RateMap.tsx';
import { HowTo, Fit } from '../AurocResults.tsx';
import { Canvas, niceTicks, ORANGE, put } from '../PethPlots.tsx';
import type { ExplorerParts, PlotType } from './explorer-parts.ts';

const alphaText = (data: ExplorerData) =>
  data.summary.settings.alpha !== undefined ? ` (α ${data.summary.settings.alpha})` : '';

// ---------------------------------------------------------------- auROC

const L = 48;
const R = 56;
const TOP = 46;

function AurocHeat(props: { m: AurocModel; sortBy: number; w: number; h: number }): JSX.Element {
  const order = createMemo(() => aurocOrder(props.m, props.sortBy));
  return (
    <Canvas
      w={props.w}
      h={props.h}
      label="Heat map of the auROC of every cell for every behavior"
      draw={(ctx) => {
        const { m } = props;
        const [pw, ph] = [props.w - L - R, props.h - TOP - 4];
        const [cw, rh] = [pw / m.behaviors.length, ph / Math.max(1, m.cells.length)];
        order().forEach((i, r) =>
          m.behaviors.forEach((_, j) => {
            ctx.fillStyle = aurocColor(m.auroc[i][j]);
            ctx.fillRect(L + j * cw, TOP + r * rh, cw + 0.4, rh + 0.4);
          }),
        );
        m.behaviors.forEach((b, j) => {
          const name = b.length > 16 ? `${b.slice(0, 15)}…` : b;
          put(ctx, name, L + (j + 0.5) * cw, TOP - 8, 'center', '#444');
        });
        const n = m.cells.length;
        for (const rank of new Set([1, Math.round(n / 2), n]))
          if (rank >= 1) put(ctx, String(rank), L - 5, TOP + (rank - 0.5) * rh + 4, 'right');
        put(ctx, 'Cells (sorted by auROC)', 11, TOP + ph / 2, 'center', '#666', -Math.PI / 2);
        const bx = L + pw + 12;
        for (let i = 0; i < ph; i++) {
          ctx.fillStyle = aurocColor(1 - i / ph);
          ctx.fillRect(bx, TOP + i, 10, 1.2);
        }
        [1, 0.5, 0].forEach((v, i) =>
          put(ctx, String(v), bx + 13, TOP + (i * (ph - 8)) / 2 + 8, 'left'),
        );
      }}
    />
  );
}

function ResponseTiles(props: { excited: number; inhibited: number; notSignificant: number }) {
  return (
    <div class="cb-rx__tiles">
      <div>
        <span class="sc">excited</span>
        <b class="cb-rx__up">{props.excited}</b>
      </div>
      <div>
        <span class="sc">inhibited</span>
        <b class="cb-rx__down">{props.inhibited}</b>
      </div>
      <div>
        <span class="sc">not significant</span>
        <b>{props.notSignificant}</b>
      </div>
    </div>
  );
}

export function aurocParts(
  m: AurocModel | undefined,
  data: ExplorerData,
): ExplorerParts | undefined {
  if (!m?.behaviors.length) return undefined;
  const [sortBy, setSortBy] = createSignal(0);
  const hasTest = m.response.some((row) => row.some((v) => v !== ''));
  return {
    headline: () => {
      const n = responseCounts(m);
      return hasTest
        ? `${n.excited + n.inhibited} of ${n.evaluated} cell-behavior pairs significant`
        : undefined;
    },
    plots: [
      {
        id: 'heatmap',
        label: 'Population auROC heat map',
        switcher: { label: 'Sort by', options: m.behaviors, index: sortBy, set: setSortBy },
        subtitle: () =>
          `Each row is a cell, sorted by its auROC for ${m.behaviors[sortBy()]} (highest first); each column is a behavior.`,
        help: () => (
          <HowTo title="Population auROC">
            <p>
              One row per cell and one column per behavior. Color is the auROC of that cell for that
              behavior: 0.5 is no discrimination, orange is above 0.5, purple below. Gray cells were
              not evaluated. The scale runs from 0 to 1 for every cell.
            </p>
            <p>
              Rows are sorted by the auROC for the behavior chosen at the right. Significance comes
              from the saved shuffle test and is listed in the Summary, not drawn here.
            </p>
          </HowTo>
        ),
        main: () => (
          <div class="cb-rx__plots">
            <div class="cb-rx__heat">
              <Fit>{(w, h) => <AurocHeat m={m} sortBy={sortBy()} w={w} h={h} />}</Fit>
            </div>
          </div>
        ),
      },
    ],
    summary: () => {
      const all = () => responseCounts(m);
      const mine = () => responseCounts(m, sortBy());
      const rows = () =>
        aurocOrder(m, sortBy()).filter((i) =>
          ['Excited', 'Inhibited'].includes(m.response[i][sortBy()]),
        );
      return (
        <Show
          when={hasTest}
          fallback={
            <p class="cb-rx__p">
              {m.cells.length} cells, {m.behaviors.length} behaviors. This run had no shuffle test,
              so no pair is labelled.
            </p>
          }
        >
          <p class="cb-rx__p">
            {all().excited + all().inhibited} of {all().evaluated} cell-behavior pairs differ from
            chance{alphaText(data)}.
          </p>
          <ResponseTiles {...all()} />
          <p class="cb-muted cb-rx__small">
            {m.behaviors[sortBy()]}: {mine().excited + mine().inhibited} of {mine().evaluated} cells
          </p>
          <div class="sc cb-rx__sub">significant cells · {m.behaviors[sortBy()]}</div>
          <div class="cb-rx__sig">
            <table class="cb-rx__table cb-rx__table--small">
              <thead>
                <tr>
                  <th>Cell</th>
                  <th>auROC</th>
                  <th>Adjusted p</th>
                  <th>Direction</th>
                </tr>
              </thead>
              <tbody>
                <For each={rows()}>
                  {(i) => (
                    <tr>
                      <td>{m.cells[i]}</td>
                      <td>{m.auroc[i][sortBy()].toFixed(3)}</td>
                      <td>
                        {Number.isNaN(m.pAdj[i][sortBy()]) ? '—' : m.pAdj[i][sortBy()].toFixed(3)}
                      </td>
                      <td
                        class={m.response[i][sortBy()] === 'Excited' ? 'cb-rx__up' : 'cb-rx__down'}
                      >
                        {m.response[i][sortBy()] === 'Excited' ? 'excited' : 'inhibited'}
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      );
    },
  };
}

// ---------------------------------------------------------------- Place cells

const PER_PAGE = 24;

/** The saved rate maps, highest spatial information first, a page at a time (one page, no pager, when `perPage` is set). */
function MapGallery(props: { cells: PlaceCell[]; maps: PlaceMaps; perPage?: number }): JSX.Element {
  const size = () => props.perPage ?? PER_PAGE;
  const [page, setPage] = createSignal(0);
  const order = createMemo(() =>
    props.cells
      .map((c, i) => ({ c, i }))
      .sort((a, b) =>
        Number.isNaN(a.c.information)
          ? 1
          : Number.isNaN(b.c.information)
            ? -1
            : b.c.information - a.c.information,
      ),
  );
  const pages = () => Math.max(1, Math.ceil(order().length / size()));
  const shown = () => order().slice(page() * size(), (page() + 1) * size());
  const mapOf = (i: number) =>
    props.maps.values.subarray(i * props.maps.nStates, (i + 1) * props.maps.nStates);
  return (
    <div class="cb-rx__gallery">
      <div class="cb-rx__gridmaps">
        <For each={shown()}>
          {({ c, i }) => {
            const v = mapOf(i);
            return (
              <figure class="cb-rx__map">
                <RateMap
                  values={v}
                  max={Math.max(0, ...Array.from(v).filter(Number.isFinite))}
                  nx={props.maps.nx}
                  ny={props.maps.ny}
                  open={Array.from(v, Number.isFinite)}
                  bin={1}
                  arenaCm={[props.maps.nx, props.maps.ny]}
                  size={220}
                />
                <figcaption>
                  Cell {c.cell} · {OVERALL[c.outcome ?? 'cannot'].label}
                </figcaption>
              </figure>
            );
          }}
        </For>
      </div>
      <Show when={!props.perPage}>
        <div class="cb-rx__pager">
          <button
            type="button"
            class="btn-secondary btn-small"
            disabled={page() === 0}
            aria-label="Previous page"
            onClick={() => setPage(page() - 1)}
          >
            ‹
          </button>
          <span class="cb-muted">
            {page() * size() + 1}–{Math.min(order().length, (page() + 1) * size())} of{' '}
            {order().length}
          </span>
          <button
            type="button"
            class="btn-secondary btn-small"
            disabled={page() + 1 >= pages()}
            aria-label="Next page"
            onClick={() => setPage(page() + 1)}
          >
            ›
          </button>
        </div>
      </Show>
    </div>
  );
}

const OUTCOME_COLOR: Record<Overall, string> = {
  both: ORANGE,
  info: '#2171b5',
  stab: '#2e7d32',
  neither: '#9e9e9e',
  cannot: '#d4d4d4',
};

function Scatter(props: { cells: PlaceCell[]; w: number; h: number }): JSX.Element {
  const ok = () =>
    props.cells.filter((c) => Number.isFinite(c.information) && Number.isFinite(c.stability));
  return (
    <Canvas
      w={props.w}
      h={props.h}
      label="Spatial information against spatial stability of each cell"
      draw={(ctx) => {
        const [l, r, t, b] = [52, 16, 10, 36];
        const xs = ok().map((c) => c.information);
        const ys = ok().map((c) => c.stability);
        const dom = (v: number[]): [number, number] => [Math.min(0, ...v), Math.max(...v, 1e-6)];
        const [x0, x1] = dom(xs);
        const [y0, y1] = [Math.min(-0.2, ...ys), Math.max(1, ...ys)];
        const X = (v: number) => l + ((v - x0) / (x1 - x0)) * (props.w - l - r);
        const Y = (v: number) => props.h - b - ((v - y0) / (y1 - y0)) * (props.h - t - b);
        ctx.strokeStyle = '#d4d4d4';
        ctx.strokeRect(l, t, props.w - l - r, props.h - t - b);
        for (const v of niceTicks(x0, x1)) put(ctx, String(v), X(v), props.h - b + 14);
        for (const v of niceTicks(y0, y1)) put(ctx, String(v), l - 5, Y(v) + 4, 'right');
        put(ctx, 'Spatial information (bits/event)', (l + props.w - r) / 2, props.h - 6);
        put(
          ctx,
          'Spatial stability (split-half r)',
          12,
          (t + props.h - b) / 2,
          'center',
          '#666',
          -Math.PI / 2,
        );
        for (const c of ok()) {
          ctx.fillStyle = OUTCOME_COLOR[c.outcome ?? 'cannot'];
          ctx.beginPath();
          ctx.arc(X(c.information), Y(c.stability), 3, 0, 2 * Math.PI);
          ctx.fill();
        }
      }}
    />
  );
}

export function placeParts(
  cells: PlaceCell[] | undefined,
  maps: PlaceMaps | undefined,
  data: ExplorerData,
): ExplorerParts | undefined {
  if (!cells?.length) return undefined;
  const counts = outcomeCounts(cells);
  const both = cells
    .filter((c) => c.outcome === 'both')
    .sort((a, b) => b.information - a.information);
  const scatter: PlotType = {
    id: 'scatter',
    label: 'Information and stability',
    subtitle: () => 'One point per cell, colored by the outcome of the two tests.',
    help: () => (
      <HowTo title="Information and stability">
        <p>
          Each point is one cell. Horizontal: spatial information (bits/event). Vertical: spatial
          stability, the split-half correlation of its rate map. Color is the saved outcome of the
          two shuffle tests.
        </p>
      </HowTo>
    ),
    main: () => (
      <div class="cb-rx__plots">
        <div class="cb-rx__heat">
          <Fit>{(w, h) => <Scatter cells={cells} w={w} h={h} />}</Fit>
        </div>
        <ul class="cb-rx__legend">
          <For each={Object.keys(OVERALL) as Overall[]}>
            {(k) => (
              <li>
                <span class="cb-dot" style={{ background: OUTCOME_COLOR[k] }} /> {OVERALL[k].label}
              </li>
            )}
          </For>
        </ul>
      </div>
    ),
  };
  const gallery: PlotType | undefined = maps && {
    id: 'maps',
    label: 'Rate maps',
    subtitle: () =>
      'One map per cell, highest spatial information first; each map is scaled to its own peak. Gray: too little time in the bin.',
    help: () => (
      <HowTo title="Rate maps">
        <p>
          One map per cell, in the arena's grid. Color is the cell's event rate in each bin, scaled
          to the peak of that cell's own map. Gray bins had too little time spent in them. Cells are
          ordered by their saved spatial information, highest first.
        </p>
      </HowTo>
    ),
    main: () => <MapGallery cells={cells} maps={maps} />,
    overview: () => <MapGallery cells={cells} maps={maps} perPage={12} />,
  };
  return {
    headline: () =>
      `${counts.both} of ${cells.length - counts.cannot} cells pass both place-cell tests`,
    plots: gallery ? [gallery, scatter] : [scatter],
    summary: () => (
      <>
        <p class="cb-rx__p">
          {counts.both} of {cells.length - counts.cannot} evaluated cells pass both tests
          {alphaText(data)}.
        </p>
        <ul class="cb-rx__counts">
          <For each={Object.keys(OVERALL) as Overall[]}>
            {(k) => (
              <li>
                <span>{OVERALL[k].label}</span>
                <b>{counts[k]}</b>
              </li>
            )}
          </For>
        </ul>
        <div class="sc cb-rx__sub">cells passing both tests</div>
        <div class="cb-rx__sig">
          <table class="cb-rx__table cb-rx__table--small">
            <thead>
              <tr>
                <th>Cell</th>
                <th>Information</th>
                <th>Stability</th>
                <th>Fields</th>
              </tr>
            </thead>
            <tbody>
              <For each={both}>
                {(c) => (
                  <tr>
                    <td>{c.cell}</td>
                    <td>{c.information.toFixed(3)}</td>
                    <td>{c.stability.toFixed(2)}</td>
                    <td>{Number.isNaN(c.nFields) ? '—' : c.nFields}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </>
    ),
  };
}
