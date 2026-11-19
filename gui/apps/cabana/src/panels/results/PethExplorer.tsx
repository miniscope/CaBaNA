import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import type { RunRecord } from '../../lib/bridge-client.ts';
import type { ExplorerData } from '../../lib/explorer-data.ts';
import {
  heatColor,
  heatLimit,
  pethCounts,
  pethMeanSpec,
  pethModel,
  populationMean,
  significantCells,
  sortCells,
  type SortKey,
  type PethBehavior,
  type PethModel,
} from '../../lib/results-peth.ts';
import { HowTo, Fit } from '../AurocResults.tsx';
import { Canvas, CurvePlot, drawOnset, put, PURPLE } from '../PethPlots.tsx';
import type { ExplorerParts } from './explorer-parts.ts';

const HEAT = { l: 48, r: 72 };
const T = 6;

const table = (data: ExplorerData, name: string) => data.tables.find((t) => t.name === name);

/** The window of the saved curves: bin centers, so the axis runs half a bin beyond the first and last. */
function domainOf(m: PethModel): [number, number] {
  const w = m.timeS.length > 1 ? m.timeS[1] - m.timeS[0] : 0;
  return [m.timeS[0] - w / 2, m.timeS[m.timeS.length - 1] + w / 2];
}

function HeatMap(props: { b: PethBehavior; model: PethModel; w: number; h: number }): JSX.Element {
  const limit = createMemo(() => heatLimit(props.b));
  return (
    <Canvas
      w={props.w}
      h={props.h}
      label={`Heat map of the mean response of each cell around the aligned frame, ${props.b.label}`}
      draw={(ctx) => {
        const cells = props.b.cells;
        const nb = props.model.timeS.length;
        const [pw, ph] = [props.w - HEAT.l - HEAT.r, props.h - T - 4];
        const [cw, rh] = [pw / nb, ph / Math.max(1, cells.length)];
        cells.forEach((c, r) => {
          for (let i = 0; i < nb; i++) {
            ctx.fillStyle = heatColor(c.mean[i], limit());
            ctx.fillRect(HEAT.l + i * cw, T + r * rh, cw + 0.4, rh + 0.4);
          }
        });
        const [lo, hi] = domainOf(props.model);
        drawOnset(ctx, HEAT.l + ((0 - lo) / (hi - lo)) * pw, T, T + ph);
        for (const rank of new Set([1, Math.round(cells.length / 2), cells.length]))
          if (rank >= 1) put(ctx, String(rank), HEAT.l - 5, T + (rank - 0.5) * rh + 4, 'right');
        put(ctx, 'Cells (sorted by response)', 11, T + ph / 2, 'center', '#666', -Math.PI / 2);
        // Color bar with the clip limit, so the scale is read from the plot itself.
        const bx = HEAT.l + pw + 12;
        for (let i = 0; i < ph; i++) {
          ctx.fillStyle = heatColor(limit() - (2 * limit() * i) / ph, limit());
          ctx.fillRect(bx, T + i, 10, 1.2);
        }
        [limit(), 0, -limit()].forEach((v, i) =>
          put(ctx, String(v), bx + 13, T + (i * (ph - 8)) / 2 + 8, 'left'),
        );
        put(
          ctx,
          props.model.baselineSubtracted ? 'Δ (a.u.)' : 'a.u.',
          bx + 54,
          T + ph / 2,
          'center',
          '#666',
          Math.PI / 2,
        );
      }}
    />
  );
}

/** The population heat map with the mean curve under it, on one time axis. */
function PethMain(props: { model: PethModel; behavior: number }): JSX.Element {
  const b = () => props.model.behaviors[props.behavior];
  const mean = createMemo(() => populationMean(b()));
  return (
    <div class="cb-rx__plots">
      <div class="cb-rx__heat">
        <Fit>{(w, h) => <HeatMap b={b()} model={props.model} w={w} h={h} />}</Fit>
      </div>
      <div class="cb-rx__curve">
        <Fit>
          {(w, h) => (
            <CurvePlot
              w={w}
              h={h}
              label={`Mean over cells of the response around the aligned frame, ${b().label}`}
              timeS={props.model.timeS}
              domain={domainOf(props.model)}
              series={[{ mean: mean(), color: PURPLE }]}
              baseline={props.model.baselineS}
              response={props.model.responseS}
              yLabel={props.model.baselineSubtracted ? 'Δ (a.u.)' : 'a.u.'}
              xLabel="Time from the aligned frame (s)"
              margin={{ l: HEAT.l, r: HEAT.r }}
            />
          )}
        </Fit>
      </div>
    </div>
  );
}

const COLUMNS: [SortKey, string][] = [
  ['cell', 'Cell'],
  ['value', 'Response (a.u.)'],
  ['latency', 'Latency (s)'],
  ['direction', 'Direction'],
];

/** Significant cells of one behavior, sortable by any column; blank values stay last. */
function SignificantCells(props: { behavior: PethBehavior }): JSX.Element {
  const [key, setKey] = createSignal<SortKey>('value');
  const [desc, setDesc] = createSignal(true);
  const rows = createMemo(() => sortCells(significantCells(props.behavior), key(), desc()));
  const pick = (k: SortKey) => {
    setDesc(k === key() ? !desc() : k !== 'cell');
    setKey(k);
  };
  return (
    <div class="cb-rx__sig">
      <table class="cb-rx__table cb-rx__table--small">
        <thead>
          <tr>
            <For each={COLUMNS}>
              {([k, label]) => (
                <th aria-sort={key() === k ? (desc() ? 'descending' : 'ascending') : 'none'}>
                  <button type="button" class="cb-rx__sort" onClick={() => pick(k)}>
                    {label}
                    {key() === k ? (desc() ? ' ▾' : ' ▴') : ''}
                  </button>
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For
            each={rows()}
            fallback={
              <tr>
                <td colspan="4" class="cb-muted">
                  No significant cells for this behavior.
                </td>
              </tr>
            }
          >
            {(c) => (
              <tr>
                <td>{c.cell}</td>
                <td>{c.value.toFixed(3)}</td>
                <td>{Number.isNaN(c.latencyS) ? '—' : c.latencyS.toFixed(2)}</td>
                <td class={c.response === 'Excited' ? 'cb-rx__up' : 'cb-rx__down'}>
                  {c.response === 'Excited' ? 'excited' : 'inhibited'}
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

const correctionWords = (c: string | undefined) =>
  c === 'max stat' ? ' after max-stat correction' : c === 'none' ? ' without correction' : '';

function Summary(props: { model: PethModel; behavior: number; data: ExplorerData }): JSX.Element {
  const b = () => props.model.behaviors[props.behavior];
  const all = () => pethCounts(props.model);
  const mine = () => pethCounts(props.model, props.behavior);
  const test = () => props.data.summary.settings;
  return (
    <>
      <Show
        when={props.model.hasTest}
        fallback={
          <p class="cb-rx__p">
            {all().evaluated + all().notEvaluated} cell-behavior pairs. This run had no shuffle
            test, so no pair is labelled as responding.
          </p>
        }
      >
        <p class="cb-rx__p">
          {all().excited + all().inhibited} of {all().evaluated} cell-behavior pairs differ from
          baseline{correctionWords(test().correction)}
          {test().alpha !== undefined ? ` (α ${test().alpha})` : ''}.
        </p>
        <div class="cb-rx__tiles">
          <div>
            <span class="sc">excited</span>
            <b class="cb-rx__up">{all().excited}</b>
          </div>
          <div>
            <span class="sc">inhibited</span>
            <b class="cb-rx__down">{all().inhibited}</b>
          </div>
          <div>
            <span class="sc">not significant</span>
            <b>{all().notSignificant}</b>
          </div>
        </div>
        <p class="cb-muted cb-rx__small">
          {b().label}: {mine().excited + mine().inhibited} of {mine().evaluated} cells
          <Show when={all().notEvaluated}> · {all().notEvaluated} pairs not evaluated</Show>
        </p>
        <div class="sc cb-rx__sub">significant cells · {b().label}</div>
        <SignificantCells behavior={b()} />
      </Show>
    </>
  );
}

/** The PETH explorer's parts, read from the run's saved tables. Undefined when they cannot be read. */
export function pethParts(record: RunRecord, data: ExplorerData): ExplorerParts | undefined {
  const model = pethModel(table(data, 'peth.csv'), table(data, 'peth_curves.csv'), data.metadata);
  if (!model?.behaviors.length) return undefined;
  const [behavior, setBehavior] = createSignal(0);
  const first = () => model.behaviors[behavior()];
  return {
    plots: [
      {
        id: 'heatmap',
        label: 'Heat map and mean curve',
        switcher: {
          label: 'Behavior',
          options: model.behaviors.map((b) => b.label),
          index: behavior,
          set: setBehavior,
        },
        subtitle: () =>
          'Each row is a cell, sorted by response (largest response minus baseline first). Orange: above baseline, purple: below.',
        help: () => (
          <HowTo title="Population PETH">
            <p>
              The heat map has one row per cell and one column per time bin around the aligned frame
              (dashed line). Color is the cell's mean response across bouts
              {model.baselineSubtracted ? ", relative to each window's baseline mean" : ''} (a.u.):
              orange above, purple below. One color scale is shared by all cells of the behavior,
              clipped at ±{heatLimit(first())}; larger values share the end colors. Gray cells have
              no value.
            </p>
            <p>
              Rows are sorted by the response (mean response minus mean baseline), largest first.
              The curve under the heat map is the mean over all cells with a value, on the same time
              axis; the shaded bands mark the baseline and response intervals the run used.
            </p>
            <p>
              Drawn from the saved result: changing the plot never changes the analysis.
              Significance comes from the saved shuffle test, not from the colors.
            </p>
          </HowTo>
        ),
        main: () => <PethMain model={model} behavior={behavior()} />,
        editSpec: () => pethMeanSpec(model, behavior(), record),
      },
    ],
    summary: () => <Summary model={model} behavior={behavior()} data={data} />,
  };
}
