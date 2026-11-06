// The auROC Population heatmap tab: cells by behavior, or ranked cells on one strip for a single behavior.

import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import {
  aurocHistogram,
  heatColor,
  heatHalfRange,
  isSingleBehavior,
  rankedByBehavior,
} from '../lib/auroc-population.ts';
import { aurocOf, pAdjOf, responseAt, RESPONSE_LABEL } from '../lib/auroc-view.ts';
import { AurocHistogram, HeatLegend, RankedStrip } from './AurocPopulationPlots.tsx';
import {
  Fit,
  HowTo,
  ListControls,
  Paged,
  Pager,
  RESPONSE_NOTE,
  Resp,
  heatRows,
  num,
  pagesOf,
  setHeatRows,
  type Ctx,
} from './AurocResults.tsx';
import { Note } from './parts.tsx';

/**
 * The current page of the shared cell list (rows) by behaviors (columns). Rows, dots, the selection outline
 * and the labels all come from one row-height scale, so each marker sits on its own cell.
 */
export function Heatmap(props: { ctx: Ctx }): JSX.Element {
  const c = () => props.ctx;
  const o = () => c().out;
  const half = createMemo(() => heatHalfRange(o()));
  const single = () => isSingleBehavior(o());
  const [hover, setHover] = createSignal<[number, number] | undefined>();
  const order = () => c().list.slice(c().heatPage * heatRows(), (c().heatPage + 1) * heatRows());
  // One behavior: every cell passing the filters, ranked by auROC, on one strip
  const strip = createMemo(() => {
    const keep = new Set(c().list);
    return rankedByBehavior(o(), 0).filter((i) => keep.has(i));
  });
  const bins = createMemo(() => aurocHistogram(o(), c().b, half()));
  const nb = () => o().labels.length;
  const [L, T, HEAD, RH] = [44, 8, 22, 14];
  const colW = () => Math.min(150, 640 / nb());
  const W = () => L + nb() * colW();
  const H = () => HEAD + T + order().length * RH + 4;
  const rowY = (i: number) => HEAD + T + i * RH;
  const sel = () => order().indexOf(c().c);
  const tip = () => {
    const h = hover();
    if (!h) return '';
    return `Cell ${o().cellIds[h[0]] + 1} · ${o().labels[h[1]]} · auROC ${num(aurocOf(o(), h[0], h[1]))} · adj. p ${num(pAdjOf(o(), h[0], h[1]))} · ${RESPONSE_LABEL[responseAt(o(), h[0], h[1])]}`;
  };
  const r = () => responseAt(o(), c().c, c().b);
  const isSig = (cell: number, b: number) => {
    const rr = responseAt(o(), cell, b);
    return rr === 'excited' || rr === 'inhibited';
  };
  let plotBox!: HTMLDivElement;
  onMount(() => {
    const ro = new ResizeObserver(([e]) =>
      setHeatRows(Math.max(4, Math.floor((e.contentRect.height - HEAD - T - 4) / RH) - 1)),
    );
    ro.observe(plotBox);
    onCleanup(() => ro.disconnect());
  });
  return (
    <div class="cb-auroc-heat cb-ar-heat">
      <div class="cb-ar-heat__main">
        <div class="cb-ar-plot__head">
          <h4>
            {single()
              ? `Cells ranked by auROC · ${o().labels[0]}`
              : 'Cell responses across behaviors'}
          </h4>
          <HowTo title="Population heatmap">
            <p>
              {single() ? (
                <>
                  Each column is one cell, ranked from the highest auROC (left) to the lowest. The
                  color shows auROC for {o().labels[0]}.
                </>
              ) : (
                <>
                  Rows are cells in the order of the cell list (set by the response filter, search
                  and sort) and columns are behaviors. Each square shows auROC for one cell and
                  behavior.
                </>
              )}{' '}
              The scale is diverging around 0.5: orange is higher during the behavior, purple is
              lower, and the range is set by the largest deviation from 0.5 in this run (
              {num(0.5 - half(), 2)} to {num(0.5 + half(), 2)}), so small effects stay visible. Gray
              means not evaluated. A dot marks a result that is significant after correction. The
              blue outline marks the selected cell
              {single() ? '' : ' and the highlighted column is the selected behavior'}.
            </p>
            <p>
              {single()
                ? 'Click a column to select that cell, then open it in the cell inspector.'
                : 'Scan across a row to compare one cell across behaviors, or down a column to compare cells for one behavior. Click a square to select that cell and behavior.'}
            </p>
            {RESPONSE_NOTE}
          </HowTo>
          <ListControls ctx={c()} />
        </div>
        <Show
          when={single()}
          fallback={
            <div class="cb-ar-heat__plot" ref={plotBox}>
              <svg
                viewBox={`0 0 ${W()} ${H()}`}
                style={{ 'max-width': `${W()}px` }}
                class="cb-auroc-heatmap"
                role="img"
                aria-label="auROC of each cell for each behavior"
              >
                <For each={o().labels}>
                  {(label, b) => (
                    <text
                      x={L + colW() * (b() + 0.5)}
                      y={14}
                      text-anchor="middle"
                      font-size="12"
                      font-weight={b() === c().b ? '700' : '400'}
                      fill={b() === c().b ? '#1f6fb2' : 'currentColor'}
                    >
                      {label}
                    </text>
                  )}
                </For>
                <For each={order()}>
                  {(cell, i) => (
                    <>
                      <text
                        x={L - 6}
                        y={rowY(i()) + RH / 2 + 4}
                        text-anchor="end"
                        font-size="11"
                        fill="currentColor"
                      >
                        {o().cellIds[cell] + 1}
                      </text>
                      <For each={o().labels}>
                        {(_, b) => (
                          <>
                            <rect
                              x={L + colW() * b() + 1}
                              y={rowY(i())}
                              width={colW() - 2}
                              height={RH}
                              fill={heatColor(aurocOf(o(), cell, b()), half())}
                              onClick={() => c().setPair(cell, b())}
                              onMouseEnter={() => setHover([cell, b()])}
                              onMouseLeave={() => setHover(undefined)}
                            />
                            <Show when={isSig(cell, b())}>
                              <circle
                                pointer-events="none"
                                cx={L + colW() * (b() + 0.5)}
                                cy={rowY(i()) + RH / 2}
                                r={3.5}
                                fill="#111"
                                stroke="#fff"
                                stroke-width="0.8"
                              />
                            </Show>
                          </>
                        )}
                      </For>
                    </>
                  )}
                </For>
                <rect
                  x={L + colW() * c().b}
                  y={HEAD + T - 2}
                  width={colW()}
                  height={order().length * RH + 4}
                  fill="#1f6fb214"
                  stroke="#1f6fb2"
                  stroke-width="1.5"
                  pointer-events="none"
                />
                <Show when={sel() >= 0}>
                  <rect
                    x={L}
                    y={rowY(sel())}
                    width={W() - L}
                    height={RH}
                    fill="none"
                    stroke="#1f6fb2"
                    stroke-width="1.5"
                    pointer-events="none"
                  />
                </Show>
              </svg>
            </div>
          }
        >
          <div class="cb-ar-heat__strip" ref={plotBox}>
            <RankedStrip
              cells={strip()}
              auroc={(cell) => aurocOf(o(), cell, 0)}
              significant={(cell) => isSig(cell, 0)}
              half={half()}
              selected={c().c}
              label={o().labels[0]}
              cellName={(cell) =>
                `Cell ${o().cellIds[cell] + 1} · auROC ${num(aurocOf(o(), cell, 0))}`
              }
              onSelect={(cell) => c().setPair(cell, 0)}
              onHover={(cell) => setHover(cell === undefined ? undefined : [cell, 0])}
            />
            <div class="cb-ar-heat__ends cb-muted">
              <span>Highest auROC</span>
              <span>{strip().length.toLocaleString()} cells</span>
              <span>Lowest</span>
            </div>
          </div>
          <div class="cb-ar-plot__head">
            <h4>auROC across cells · {o().labels[0]}</h4>
            <HowTo title="auROC across cells">
              <p>
                Each bar counts evaluated cells with an auROC in that range. Orange and purple are
                significant higher and lower cells after correction, gray is not significant. The
                dashed line is 0.5, no tendency. The x range is the same as the heatmap color scale.
                Cells not evaluated are left out.
              </p>
            </HowTo>
          </div>
          <Fit>{(w, h) => <AurocHistogram bins={bins()} half={half()} w={w} h={h} />}</Fit>
        </Show>
        <div class="cb-muted" aria-live="polite">
          {tip() || 'Hover for values; click to select the cell.'}
        </div>
        <Show when={!single()}>
          <Note title="Included frames by behavior">
            <Paged items={o().info} size={5}>
              {(rows) => (
                <table class="cb-auroc-table">
                  <thead>
                    <tr>
                      <th>Behavior</th>
                      <th>During</th>
                      <th>Outside</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={rows}>
                      {(i) => (
                        <tr>
                          <td>{i.label}</td>
                          <td>{i.during.toLocaleString()}</td>
                          <td>{i.outside.toLocaleString()}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              )}
            </Paged>
          </Note>
          <Pager
            page={c().heatPage}
            pages={pagesOf(c().list.length, heatRows())}
            size={heatRows()}
            n={c().list.length}
            onPage={c().setHeatPage}
          />
        </Show>
      </div>
      <div class="cb-ar-heat__side">
        <div class="cb-setgroup">
          <h4>
            Selected pair: {`Cell ${o().cellIds[c().c] + 1}`} · {o().labels[c().b]}
          </h4>
          <div class="cb-ar-stats">
            <div>
              <div class="cb-muted">auROC</div>
              <strong class="cb-auroc-big">{num(aurocOf(o(), c().c, c().b))}</strong>
            </div>
            <div>
              <div class="cb-muted">
                {o().settings.correction === 'max_stat' ? 'Adjusted p' : 'Uncorrected p'}
              </div>
              <strong class="cb-auroc-big">{num(pAdjOf(o(), c().c, c().b))}</strong>
            </div>
          </div>
          <Resp r={r()} />{' '}
          <button class="btn-secondary btn-small" onClick={c().openInspector}>
            Open in cell inspector
          </button>
        </div>
        <HeatLegend half={half()} />
      </div>
    </div>
  );
}
