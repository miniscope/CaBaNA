// PETH results, population view: behavior selector, the cells x time heatmap, the mean curves under
// it on the same time axis, and a preview of the selected cell.

import { createMemo, For, Show, type JSX } from 'solid-js';
import {
  behaviorReason,
  binFrames,
  clipLimit,
  curveOf,
  deltaColor,
  hasTest,
  labelAt,
  latencyOf,
  meanOverCells,
  pAdjOf,
  rawWindows,
  SORT_LABEL,
  timeDomain,
  valueOf,
  whyNotEvaluated,
  type CellSort,
  pUsedName,
  type CellFilter,
  timeAxisLabel,
} from '../lib/peth-view.ts';
import type { PethOutcome } from '../lib/peth-run.ts';
import { Fit, HowTo } from './AurocResults.tsx';
import {
  Canvas,
  CurvePlot,
  drawOnset,
  drawTimeAxis,
  fmtP,
  GRAY,
  ORANGE,
  put,
  PURPLE,
  Raster,
  SIDE,
} from './PethPlots.tsx';
import { alignWord, colorOf, Dot, intervalText, Label, LabelNote, type Ctx } from './PethShared.tsx';

/** Left and right margins shared by the heatmap and the mean curves under it, so their time axes line up. */
const HEAT = { l: 48, r: 92 };

const yUnit = (o: PethOutcome) => (o.params.baselineSubtract ? 'Δ from baseline (a.u.)' : 'neural (a.u.)');
/** The bin width of the curves, e.g. "0.1 s". */
export const binText = (o: PethOutcome) => `${+(binFrames(o) / o.input.fs).toFixed(3)} s`;

/** The cell's raw windows range for the raster: 1st to 99th percentile of the values. */
export function rawLimits(data: Float32Array): [number, number] {
  const v = Array.from(data).filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return [0, 1];
  const q = (p: number) => v[Math.floor(p * (v.length - 1))];
  return [q(0.01), q(0.99)];
}

export function BehaviorList(props: { ctx: Ctx }): JSX.Element {
  const o = () => props.ctx.out;
  return (
    <div class="cb-plot cb-pe-behaviors" role="group" aria-label="Behavior">
      <div class="cb-muted cb-pe-small">Behavior</div>
      <For each={o().labels}>
        {(label, bi) => {
          const b = bi();
          const reason = () => behaviorReason(o(), b);
          return (
            <button
              type="button"
              class="cb-pe-beh"
              classList={{ 'cb-pe-beh--on': props.ctx.b === b }}
              disabled={!!reason()}
              aria-pressed={props.ctx.b === b}
              onClick={() => props.ctx.setB(b)}
            >
              <span>
                <Dot label={label} muted={!!reason()} /> {label}
              </span>
              <span class="cb-muted cb-pe-small">
                {reason() ? `Not evaluated: ${reason()}` : `${o().reports[b].onsets.length} onsets`}
              </span>
            </button>
          );
        }}
      </For>
    </div>
  );
}

function HeatCanvas(props: { ctx: Ctx; w: number; h: number }): JSX.Element {
  const c = () => props.ctx;
  const o = () => c().out;
  const lim = createMemo(() => clipLimit(o(), c().b));
  const [T, B] = [28, 32];
  const geom = () => {
    const ph = props.h - T - B;
    return { pw: props.w - HEAT.l - HEAT.r, ph, rh: ph / Math.max(1, c().order.length) };
  };
  return (
    <Canvas
      w={props.w}
      h={props.h}
      label={`Heatmap of the mean ${yUnit(o())} of each cell around behavior onset`}
      onClick={(_, y) => {
        const r = Math.floor((y - T) / geom().rh);
        if (r >= 0 && r < c().order.length) c().setC(c().order[r]);
      }}
      draw={(ctx) => {
        const out = o();
        const { pw, ph, rh } = geom();
        const dom = timeDomain(out);
        const x = (t: number) => HEAT.l + ((t - dom[0]) / (dom[1] - dom[0])) * pw;
        const nb = out.curves.bins;
        const cw = pw / nb;
        c().order.forEach((cell, r) => {
          const { mean } = curveOf(out, cell, c().b);
          for (let i = 0; i < nb; i++) {
            ctx.fillStyle = Number.isFinite(mean[i]) ? deltaColor(mean[i], lim()) : '#e6e6e6';
            ctx.fillRect(HEAT.l + i * cw, T + r * rh, cw + 0.4, rh + 0.4);
          }
        });
        // interval bars and labels above the plot
        for (const [iv, color, name] of [
          [out.params.baselineS, PURPLE, 'Baseline'],
          [out.params.responseS, ORANGE, 'Response'],
        ] as const) {
          ctx.fillStyle = color;
          ctx.fillRect(x(iv[0]), T - 8, Math.max(1, x(iv[1]) - x(iv[0])), 4);
          put(ctx, `${name} ${intervalText(iv)}`, (x(iv[0]) + x(iv[1])) / 2, T - 12, 'center', color);
        }
        drawOnset(ctx, x(0), T, T + ph);
        drawTimeAxis(ctx, x, dom, T + ph, timeAxisLabel());
        // cell rank labels, then the selected cell
        const n = c().order.length;
        for (const rank of new Set([1, Math.round(n / 2), n])) if (rank >= 1) put(ctx, String(rank), HEAT.l - 5, T + (rank - 0.5) * rh + 4, 'right');
        put(ctx, `Cells (sorted by ${SORT_LABEL[c().sort]})`, 11, T + ph / 2, 'center', '#666', -Math.PI / 2);
        const sel = c().order.indexOf(c().c);
        if (sel >= 0) {
          ctx.strokeStyle = '#0969da';
          ctx.lineWidth = 2;
          ctx.strokeRect(HEAT.l - 1, T + sel * rh - 1, pw + 16, Math.max(rh, 1) + 2);
          ctx.lineWidth = 1;
          put(ctx, `Cell ${out.cellIds[c().c] + 1}`, HEAT.l - 5, T + sel * rh - 4, 'right', '#0969da');
        }
        // significance marker column
        const sx = HEAT.l + pw + 6;
        if (hasTest(out)) {
          put(ctx, 'Sig.', sx + 5, T - 12);
          c().order.forEach((cell, r) => {
            const l = labelAt(out, cell, c().b);
            if (l !== 'excited' && l !== 'inhibited') return;
            const yy = T + r * rh + rh / 2;
            const s = Math.min(5, Math.max(2, rh * 0.8));
            ctx.fillStyle = l === 'excited' ? ORANGE : PURPLE;
            ctx.beginPath();
            if (l === 'excited') {
              ctx.moveTo(sx, yy + s / 2);
              ctx.lineTo(sx + 10, yy + s / 2);
              ctx.lineTo(sx + 5, yy - s / 2);
            } else {
              ctx.moveTo(sx, yy - s / 2);
              ctx.lineTo(sx + 10, yy - s / 2);
              ctx.lineTo(sx + 5, yy + s / 2);
            }
            ctx.fill();
          });
        }
        // color bar
        const bx = HEAT.l + pw + 26;
        for (let i = 0; i < ph; i++) {
          ctx.fillStyle = deltaColor(lim() - (2 * lim() * i) / ph, lim());
          ctx.fillRect(bx, T + i, 10, 1.2);
        }
        [lim(), 0, -lim()].forEach((v, i) => put(ctx, String(v), bx + 13, T + (i * ph) / 2 + 4, 'left'));
        put(ctx, yUnit(out), bx + 52, T + ph / 2, 'center', '#666', Math.PI / 2);
      }}
    />
  );
}

function MeanCurves(props: { ctx: Ctx; w: number; h: number }): JSX.Element {
  const o = () => props.ctx.out;
  const groups = createMemo(() => {
    const b = props.ctx.b;
    const ev = o().cellIds.map((_, c) => c).filter((c) => Number.isFinite(valueOf(o(), c, b)));
    const pick = (r: string) => ev.filter((c) => labelAt(o(), c, b) === r);
    return { all: ev, higher: pick('excited'), lower: pick('inhibited') };
  });
  const series = () => {
    const g = groups();
    const b = props.ctx.b;
    return [
      { ...meanOverCells(o(), b, g.all), color: GRAY },
      ...(hasTest(o())
        ? [
            ...(g.higher.length ? [{ ...meanOverCells(o(), b, g.higher), color: ORANGE }] : []),
            ...(g.lower.length ? [{ ...meanOverCells(o(), b, g.lower), color: PURPLE }] : []),
          ]
        : []),
    ];
  };
  return (
    <CurvePlot
      w={props.w}
      h={props.h}
      label="Mean curves of all evaluated cells, Higher cells and Lower cells"
      timeS={o().curves.timeS}
      domain={timeDomain(o())}
      series={series()}
      baseline={o().params.baselineS}
      response={o().params.responseS}
      yLabel={o().params.baselineSubtract ? 'Δ (a.u.)' : 'a.u.'}
      xLabel={timeAxisLabel()}
      margin={{ l: HEAT.l, r: HEAT.r }}
    />
  );
}

/** The selected cell: its single-onset windows, its mean response, and the way into the inspector. */
function Preview(props: { ctx: Ctx }): JSX.Element {
  const c = () => props.ctx;
  const o = () => c().out;
  const raw = createMemo(() => rawWindows(o(), c().c, c().b));
  const k = () => curveOf(o(), c().c, c().b);
  const why = () => whyNotEvaluated(o(), c().c, c().b);
  return (
    <>
      <div class="cb-plot__head">
        <h3>
          Cell {o().cellIds[c().c] + 1} · {o().labels[c().b]}
        </h3>
      </div>
      <div class="cb-pe-line">
        <Label out={o()} r={labelAt(o(), c().c, c().b)} />
        <Show when={hasTest(o())}>
          <span>{pUsedName(o())} {fmtP(pAdjOf(o(), c().c, c().b))}</span>
        </Show>
      </div>
      <Show when={why()}>
        <div class="cb-muted cb-pe-small">Not evaluated: {why()}.</div>
      </Show>
      <div class="cb-ar-plot__head">
        <h4>Single onsets, raw windows ({raw().rows})</h4>
        <RasterHelp out={o()} />
      </div>
      <div class="cb-pe-prev-raster">
        <Fit>
          {(w, h) => (
            <Raster
              w={w}
              h={h}
              data={raw().data}
              rows={raw().rows}
              cols={raw().cols}
              domain={timeDomain(o())}
              lim={rawLimits(raw().data)}
              label={`Raw neural windows of cell ${o().cellIds[c().c] + 1}, one row per onset`}
            />
          )}
        </Fit>
      </div>
      <div class="cb-ar-plot__head">
        <h4>Mean response</h4>
        <MeanHelp out={o()} />
      </div>
      <div class="cb-pe-prev-mean">
        <Fit>
          {(w, h) => (
            <CurvePlot
              w={w}
              h={h}
              label={`Mean response of cell ${o().cellIds[c().c] + 1}`}
              timeS={o().curves.timeS}
              domain={timeDomain(o())}
              series={[{ mean: k().mean, sem: k().sem, color: colorOf(o().labels[c().b]) }]}
              band={k().lo && k().hi ? { lo: k().lo!, hi: k().hi! } : undefined}
              latencyS={latencyOf(o(), c().c, c().b)}
              baseline={o().params.baselineS}
              response={o().params.responseS}
              yLabel={o().params.baselineSubtract ? 'Δ (a.u.)' : 'a.u.'}
              xLabel={timeAxisLabel()}
              margin={{ r: SIDE }}
            />
          )}
        </Fit>
      </div>
      <div class="cb-muted cb-pe-small">
        {o().params.baselineSubtract ? 'Baseline-subtracted' : 'Not baseline-subtracted'}, {binText(o())} bins, ± SEM
        across onsets{o().band ? ' · gray: null band' : ''}. {DIR_NOTE}
      </div>
      <button class="btn-secondary cb-pe-open" onClick={c().openInspector}>
        Open cell inspector
      </button>
    </>
  );
}

const DIR_NOTE = 'Higher and Lower describe the direction relative to the baseline interval, not a mechanism.';

export function RasterHelp(props: { out: PethOutcome }): JSX.Element {
  return (
    <HowTo title="Single-bout windows">
      <p>
        Each row is the raw smoothed deconvolved trace (a.u.) of this cell around one included bout, aligned to{' '}
        {alignWord(props.out)}. The dashed line marks the aligned point. Windows are not baseline-subtracted or binned,
        so you can see variation across occurrences. The gray scale runs from the 1st to the 99th percentile of the
        values shown.
      </p>
    </HowTo>
  );
}

export function MeanHelp(props: { out: PethOutcome }): JSX.Element {
  const o = () => props.out;
  return (
    <HowTo title="Mean response">
      <p>
        The line is the average response across bouts{o().params.baselineSubtract ? ', after subtracting each window\'s baseline mean' : ''},
        in {binText(o())} bins (a.u.). The shaded region around it is ± SEM across bouts. Colored bars mark the
        baseline ({intervalText(o().params.baselineS)}) and response ({intervalText(o().params.responseS)}) intervals; the
        test uses the unbinned interval means.
      </p>
      <Show when={o().band} fallback={<p>The null band and latency were off in this run.</p>}>
        <p>
          The gray band is the 2.5th to 97.5th percentile of the same curve after {o().settings.bandShifts} circular
          shifts of this cell's trace. See "How is latency estimated?" for how it is used.
        </p>
      </Show>
    </HowTo>
  );
}

export function PopulationView(props: { ctx: Ctx }): JSX.Element {
  const c = () => props.ctx;
  const o = () => c().out;
  const counts = () => {
    const ev = o().cellIds.map((_, i) => i).filter((i) => Number.isFinite(valueOf(o(), i, c().b)));
    const n = (r: string) => ev.filter((i) => labelAt(o(), i, c().b) === r).length;
    return { all: ev.length, higher: n('excited'), lower: n('inhibited') };
  };
  const key = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = c().order.indexOf(c().c);
    const next = c().order[Math.min(c().order.length - 1, Math.max(0, i + d))];
    if (next !== undefined) c().setC(next);
  };
  return (
    <div class="cb-pe-pop">
      <BehaviorList ctx={c()} />
      <section class="cb-plot cb-pe-heat" tabindex="0" onKeyDown={key} aria-label="Population heatmap: arrow keys change the selected cell">
        <div class="cb-plot__head">
          <h3>Population PETH · {o().labels[c().b]}</h3>
          <HowTo title="Population PETH">
            <p>
              Each row is a cell and each column a {binText(o())} time bin from {timeDomain(o())[0].toFixed(1)} to{' '}
              {timeDomain(o())[1].toFixed(1)} s around {alignWord(o())}. Color is the mean response across bouts
              {o().params.baselineSubtract ? ', relative to each window\'s baseline mean' : ''} (a.u.): orange is higher,
              purple is lower. The dashed line marks the aligned point. The scale is clipped at ±{clipLimit(o(), c().b)};
              larger values share the end colors. Gray rows have no value for this behavior.
            </p>
            <p>
              Bars above the plot mark the baseline ({intervalText(o().params.baselineS)}) and response (
              {intervalText(o().params.responseS)}) intervals. Triangles in the marker column mark cells with a
              significant response (▲ higher, ▼ lower).
            </p>
            <LabelNote out={o()} />
            <p>
              Sorting: response puts the largest response minus baseline first; latency puts the earliest
              null-band latency first (without a null band, the time of the largest absolute value in the
              response interval); peak time puts the earliest highest point of the curve first. Cells
              without a value come last.
            </p>
            <p>
              Show limits the heatmap and the cell list to cells labelled Higher or Lower for the selected behavior;
              the mean curves below always use every evaluated cell. Higher and Lower here are defined against this
              PETH's baseline interval and its own shuffle test, so they are not interchangeable with the auROC labels.
            </p>
            <p>Click a row, or use the up and down arrow keys, to select a cell.</p>
          </HowTo>
          <span class="cb-plot__legend">
            <Show when={hasTest(o())}>
              Show
              <select
                aria-label="Filter cells by response"
                title="Cells labelled Higher or Lower for this behavior. The direction is relative to this PETH's own baseline interval; it is not the same label as auROC's."
                value={c().filter}
                onChange={(e) => c().setFilter(e.currentTarget.value as CellFilter)}
              >
                <option value="all">All cells ({counts().all})</option>
                <option value="excited">▲ Higher (excited) ({counts().higher})</option>
                <option value="inhibited">▼ Lower (inhibited) ({counts().lower})</option>
              </select>
            </Show>
            Sort
            <select
              aria-label="Sort cells"
              value={c().sort}
              onChange={(e) => c().setSort(e.currentTarget.value as CellSort)}
            >
              <For each={Object.entries(SORT_LABEL)}>{([k, l]) => <option value={k}>{l}</option>}</For>
            </select>
          </span>
        </div>
        <div class="cb-pe-heat__map">
          <Fit>{(w, h) => <HeatCanvas ctx={c()} w={w} h={h} />}</Fit>
        </div>
        <div class="cb-ar-plot__head">
          <h4>Mean curves</h4>
          <HowTo title="Mean curves">
            <p>
              Lines show the average response across cells in each group; shading shows ± SEM across cells. The gray
              line is every evaluated cell
              {hasTest(o()) ? '; the Higher (orange) and Lower (purple) groups contain the cells classified as significant in those directions for the selected behavior' : ''}.
              The time axis matches the heatmap. The curves are {o().params.baselineSubtract ? 'baseline-subtracted and ' : ''}binned ({binText(o())}); the
              test uses the unbinned interval means.
            </p>
            <Show when={hasTest(o())}>
              <p>{DIR_NOTE}</p>
            </Show>
          </HowTo>
          <span class="cb-muted cb-pe-small cb-pe-legend">
            <span style={{ color: GRAY }}>━ All ({counts().all})</span>
            <Show when={hasTest(o())}>
              <span style={{ color: ORANGE }}>━ Higher ({counts().higher})</span>
              <span style={{ color: PURPLE }}>━ Lower ({counts().lower})</span>
            </Show>
            <span>± SEM across cells</span>
          </span>
        </div>
        <div class="cb-pe-heat__curves">
          <Fit>{(w, h) => <MeanCurves ctx={c()} w={w} h={h} />}</Fit>
        </div>
      </section>
      <section class="cb-plot cb-pe-prev">
        <Preview ctx={c()} />
      </section>
    </div>
  );
}
