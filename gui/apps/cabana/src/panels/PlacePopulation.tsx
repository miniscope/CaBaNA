import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { HowToRead } from './parts.tsx';
import { OVERALL, OVERALL_ORDER } from '../lib/place-outcome.ts';
import { gradientCss } from '../lib/place-display.ts';
import { FILTERS, type ResultsCtx } from './place-ctx.ts';
import {
  MetricStrip,
  OUTCOME_COLOR,
  PopulationTuning,
  tuningOrder,
  type TuningSort,
} from './PlaceCharts.tsx';

const SORT_LABEL: Record<TuningSort, string> = {
  peak: 'Peak location',
  information: 'Spatial information',
  stability: 'Spatial stability',
  cell: 'Cell number',
};

/** The order in which the analysis counts bins: row by row, left to right, from the bottom-left corner. */
function BinOrder(props: { nx: number; ny: number; nStates: number }): JSX.Element {
  const W = 100;
  const rowsShown = () => Math.min(props.ny, 5);
  const H = () => Math.min(70, Math.max(30, (W - 16) * (props.ny / props.nx)));
  const top = 4;
  const gap = () => H() / rowsShown();
  const y = (k: number) => top + H() - (k + 0.5) * gap();
  return (
    <svg
      viewBox={`0 0 ${W} ${H() + 26}`}
      width="100%"
      role="img"
      aria-label="Bins are counted row by row from the bottom-left corner of the arena, each row left to right"
    >
      <rect x="8" y={top} width={W - 16} height={H()} fill="none" stroke="#999" />
      <For each={Array.from({ length: rowsShown() }, (_, k) => k)}>
        {(k) => (
          <>
            <line x1="12" x2={W - 14} y1={y(k)} y2={y(k)} stroke="#2171b5" />
            <path d={`M${W - 14} ${y(k)} l-4 -2.5 v5 z`} fill="#2171b5" />
          </>
        )}
      </For>
      <text x="8" y={top + H() + 10} font-size="8" fill="#666">
        Bin 1 (bottom left)
      </text>
      <text x="8" y={top + H() + 20} font-size="8" fill="#666">
        Bin {props.nStates} (top right)
      </text>
    </svg>
  );
}

/** The two ranked tests and the spatial tuning of every cell. */
export function PlacePopulation(props: { ctx: ResultsCtx }): JSX.Element {
  const c = () => props.ctx;
  const r = () => c().out.result;
  const alpha = () => c().out.settings.alpha;
  const { nx, ny, open } = props.ctx.out.data.grid;
  const [sort, setSort] = createSignal<TuningSort>('peak');
  const flags = (pick: (o: { info: string; stab: string }) => boolean) =>
    Uint8Array.from(c().rows(), (row) => (pick(row) ? 1 : 0));
  const outcome = createMemo(() =>
    Uint8Array.from(c().rows(), (row) => OVERALL_ORDER.indexOf(row.overall)),
  );
  const include = createMemo(() =>
    Uint8Array.from(c().rows(), (row) =>
      c().filter() === 'all' || row.overall === c().filter() ? 1 : 0,
    ),
  );
  const tuning = () => ({
    rate: r().rate,
    nStates: r().nStates,
    cells: r().cells,
    include: include(),
    sort: sort(),
    information: r().information,
    stability: r().stability,
  });
  const order = createMemo(() => tuningOrder(tuning()));
  const row = () => order().indexOf(c().selected());
  const selectedId = () => c().out.data.cellIds[c().selected()];

  return (
    <>
      <div class="cb-poptop">
        <span class="cb-muted">{c().rows().length} cells · full population</span>
      </div>
      <div class="cb-strips">
        <MetricStrip
          title="Spatial information"
          rankedBy="information"
          unit="bits/event"
          values={r().information}
          p={r().pInformation}
          ids={c().out.data.cellIds}
          nullValues={r().nullInformation}
          nShifts={r().nShifts}
          passed={flags((o) => o.info === 'pass')}
          alpha={alpha()}
          selected={c().selected()}
          onPick={(i) => c().pick(i)}
        />
        <MetricStrip
          title="Spatial stability"
          rankedBy="stability"
          unit="correlation r"
          values={r().stability}
          p={r().pStability}
          ids={c().out.data.cellIds}
          nullValues={r().nullStability}
          nShifts={r().nShifts}
          passed={flags((o) => o.stab === 'pass')}
          alpha={alpha()}
          selected={c().selected()}
          onPick={(i) => c().pick(i)}
        />
      </div>
      <div class="cb-legend">
        <span class="cb-legend__item">
          <svg width="12" height="12" aria-hidden="true">
            <circle cx="6" cy="6" r="4.5" fill="#2171b5" />
          </svg>
          Significant (p &lt; {alpha()})
        </span>
        <span class="cb-legend__item">
          <svg width="12" height="12" aria-hidden="true">
            <circle cx="6" cy="6" r="4" fill="#fff" stroke="#888" />
          </svg>
          Not significant
        </span>
        <span
          class="cb-legend__item"
          title={`For each cell, the grey band runs from the median of its shuffled scores up to the value that only ${alpha() * 100}% of them reach. A real score above the band gives p < ${alpha()}.`}
        >
          <i style={{ background: '#d9d9d5' }} />
          Shuffled scores: median to {100 - alpha() * 100}th percentile ⓘ
        </span>
      </div>
      <p class="cb-muted">Each plot ranks cells separately. Click a point to select that cell.</p>
      <HowToRead>
        <p>
          Each point is one cell, ranked from lowest to highest score for that measure. Filled points are significant. The grey
          band runs from the median of the cell’s shifted scores up to the value only a small share of them reach, so a point above
          the band has p below the threshold. Higher information means events are concentrated in fewer places; higher stability
          means the first-half and second-half maps match.
        </p>
      </HowToRead>

      <div class="cb-heat">
        <div class="cb-heat__main">
          <div class="cb-heat__bar">
            <h4>Spatial tuning across cells</h4>
            <label class="cb-sortpick cb-sortpick--small">
              Show
              <select
                value={c().filter()}
                onChange={(e) => c().setFilter(e.currentTarget.value as never)}
              >
                <For each={FILTERS}>{([k, label]) => <option value={k}>{label}</option>}</For>
              </select>
            </label>
            <label class="cb-sortpick cb-sortpick--small">
              Sort rows by
              <select value={sort()} onChange={(e) => setSort(e.currentTarget.value as TuningSort)}>
                <For each={Object.keys(SORT_LABEL) as TuningSort[]}>
                  {(k) => <option value={k}>{SORT_LABEL[k]}</option>}
                </For>
              </select>
            </label>
          </div>
          <p class="cb-muted">
            Each row shows one cell’s spatial activity, scaled from its lowest to its highest bin.
            Rows are sorted by {SORT_LABEL[sort()].toLowerCase()}.
          </p>
          <PopulationTuning
            {...tuning()}
            outcome={outcome()}
            outcomes={OVERALL_ORDER}
            open={open}
            selected={c().selected()}
            onPick={(i) => c().pick(i)}
          />
          <div class="cb-heat__axis cb-muted">
            <span>Bin 1</span>
            <span>Spatial bins · arena flattened row by row</span>
            <span>Bin {r().nStates}</span>
          </div>
          <div class="cb-legend">
            <span class="cb-legend__item">Relative to the cell’s range</span>
            <span class="cb-legend__item">0</span>
            <span class="cb-legend__bar" style={{ background: gradientCss('right') }} />
            <span class="cb-legend__item">1</span>
            <span class="cb-legend__item">
              <i style={{ background: '#d4d4d0' }} /> Below minimum sampling time
            </span>
            <span class="cb-legend__item">
              <i style={{ background: '#fff' }} /> Outside arena
            </span>
          </div>
          <p class="cb-muted">
            Colors show relative activity within each cell, not absolute rates across cells.
          </p>
          <HowToRead>
            <p>
              Each row is one cell and each column one spatial bin, counted row by row across the arena. Color shows the cell’s
              activity in that bin relative to its own lowest and highest bin, so rows cannot be compared by brightness. A cell
              with one tuned location shows a bright block in a few neighboring columns. Rows are sorted by the measure chosen above.
            </p>
          </HowToRead>
        </div>
        <div class="cb-heat__side">
          <div class="cb-side-box">
            <h4>Significant tests</h4>
            <For each={OVERALL_ORDER}>
              {(k) => (
                <div class="cb-keyrow">
                  <i style={{ background: OUTCOME_COLOR[k] }} />
                  {OVERALL[k].label} ({c().counts()[k]})
                </div>
              )}
            </For>
          </div>
          <div class="cb-side-box">
            <h4>Spatial bin order</h4>
            <BinOrder nx={nx} ny={ny} nStates={r().nStates} />
            <p class="cb-muted">
              Bins are counted row by row from the bottom-left corner of the arena. Bins outside the
              arena keep their place.
            </p>
            <HowToRead>
              <p>
                This small map shows how the arena is flattened into the bin columns of the heatmap: bin 1 is the bottom-left corner,
                counting left to right along each row, then up.
              </p>
            </HowToRead>
          </div>
        </div>
      </div>
      <div class="cb-selbar">
        <span>
          Selected: Cell {selectedId() + 1}
          <Show
            when={row() >= 0}
            fallback={<span class="cb-muted"> · not drawn (filtered out or no defined map)</span>}
          >
            {' '}
            · row {row() + 1} of {order().length}
          </Show>
        </span>
        <button class="cb-link" onClick={() => c().openInspector()}>
          Open in cell inspector ↗
        </button>
      </div>
    </>
  );
}
