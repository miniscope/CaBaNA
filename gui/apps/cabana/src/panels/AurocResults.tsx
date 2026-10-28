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
import { Portal } from 'solid-js/web';
import { MIN_FRAMES, type Response } from '../lib/auroc.ts';
import { aurocCsv, aurocMetadata } from '../lib/auroc-export.ts';
import { shiftedValues, type AurocOutcome } from '../lib/auroc-run.ts';
import {
  aurocColor,
  aurocOf,
  pAdjOf,
  pRawOf,
  rankedCells,
  responseAt,
  RESPONSES,
  RESPONSE_LABEL,
  strength,
  summarize,
} from '../lib/auroc-view.ts';
import { downloadText } from '../lib/place-export.ts';
import { deconvolved, goToStep } from '../lib/store.ts';
import { Footprint } from './FootprintStrip.tsx';
import { createSize } from './QcParts.tsx';
import { InfoTip } from './InfoTip.tsx';
import { Popover } from './Popover.tsx';
import { AurocScale, behaviorColor } from './AurocPanel.tsx';
import { fitToWindow } from './QcPanel.tsx';

type View = 'inspector' | 'heatmap' | 'summary';
const VIEWS: [View, string][] = [
  ['inspector', 'Cell inspector'],
  ['heatmap', 'Tuning heatmap'],
  ['summary', 'Behavior summary'],
];
type Sort = 'strength' | 'auroc' | 'cell';
type Filter = Response | 'all';
const CELL_PAGE = 10;
const HEAT_PAGE = 20;

const num = (v: number, d = 3) => (Number.isNaN(v) ? '–' : v.toFixed(d));
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '–');
const respClass = (r: Response) => `cb-resp cb-resp--${r.replace(' ', '-')}`;
export const Resp = (props: { r: Response }): JSX.Element => (
  <span class={respClass(props.r)}>{RESPONSE_LABEL[props.r]}</span>
);

/** What the response labels mean. Shown in the Response tip and in the plots' reading notes. */
const RESPONSE_NOTE = (
  <>
    <p>
      A cell-behavior pair is <strong>Higher (excited)</strong> when the adjusted p-value (the uncorrected p-value with no correction) is below α
      and auROC is above 0.5, and <strong>Lower (inhibited)</strong> when it is below α and auROC is
      below 0.5. Otherwise it is <strong>Not significant</strong>. <strong>Not evaluated</strong>{' '}
      means auROC was undefined: the cell has a missing neural value among the included frames, or
      the behavior has fewer than {MIN_FRAMES} included frames during or outside it.
    </p>
    <p>
      Higher and Lower describe activity during the behavior relative to the reference group. They
      do not imply a mechanism such as synaptic excitation or inhibition.
    </p>
    <p>
      Not significant is not evidence of no relationship. A direction is shown only for significant
      results; symbols and labels follow the adjusted p-value, never color.
    </p>
  </>
);

/** A "How to read this plot" link that opens its explanation in a popover. */
export function HowTo(props: { title: string; children: JSX.Element }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  let btn!: HTMLButtonElement;
  return (
    <>
      <button
        ref={btn}
        type="button"
        class="cb-link cb-ar-how"
        aria-haspopup="dialog"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        How to read this plot
      </button>
      <Show when={open()}>
        <Popover
          anchor={btn}
          onClose={() => setOpen(false)}
          width={380}
          label={`How to read: ${props.title}`}
          class="cb-ar-pop"
        >
          {props.children}
        </Popover>
      </Show>
    </>
  );
}

/** A dialog over the page. Escape, the backdrop or the close button closes it, and focus goes back to where it was. */
export function Modal(props: {
  title: string;
  onClose: () => void;
  size?: 'wide';
  children: JSX.Element;
}): JSX.Element {
  let close!: HTMLButtonElement;
  let box!: HTMLDivElement;
  const opener = document.activeElement as HTMLElement | null;
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') return props.onClose();
    if (e.key !== 'Tab') return;
    const f = [
      ...box.querySelectorAll<HTMLElement>('button, select, input, a[href], [tabindex="0"]'),
    ];
    const [first, last] = [f[0], f[f.length - 1]];
    if (e.shiftKey && document.activeElement === first) last.focus();
    else if (!e.shiftKey && document.activeElement === last) first.focus();
    else return;
    e.preventDefault();
  };
  onMount(() => {
    close.focus();
    document.addEventListener('keydown', key);
  });
  onCleanup(() => {
    document.removeEventListener('keydown', key);
    opener?.focus();
  });
  return (
    <Portal>
      <div class="cb-overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
        <div
          ref={box}
          class="cb-overlay__box cb-ar-modal"
          classList={{ 'cb-ar-modal--wide': props.size === 'wide' }}
          role="dialog"
          aria-modal="true"
          aria-label={props.title}
        >
          <div class="cb-plot__head">
            <h3>{props.title}</h3>
            <button
              ref={close}
              type="button"
              class="cb-ib"
              aria-label="Close"
              onClick={props.onClose}
            >
              ✕
            </button>
          </div>
          <div class="cb-ar-modal__body">{props.children}</div>
        </div>
      </div>
    </Portal>
  );
}

/** "a–b of n" with previous and next page buttons. */
function Pager(props: {
  page: number;
  pages: number;
  size: number;
  n: number;
  onPage: (p: number) => void;
}): JSX.Element {
  const from = () => (props.n ? props.page * props.size + 1 : 0);
  const to = () => Math.min(props.n, (props.page + 1) * props.size);
  return (
    <div class="cb-pager">
      <span class="cb-muted" aria-live="polite">
        {from()}–{to()} of {props.n}
      </span>
      <button
        class="btn-secondary btn-small"
        aria-label="Previous page"
        disabled={props.page <= 0}
        onClick={() => props.onPage(props.page - 1)}
      >
        ‹
      </button>
      <span class="cb-muted">
        {props.page + 1} / {props.pages}
      </span>
      <button
        class="btn-secondary btn-small"
        aria-label="Next page"
        disabled={props.page >= props.pages - 1}
        onClick={() => props.onPage(props.page + 1)}
      >
        ›
      </button>
    </div>
  );
}

/** A short list shown a page at a time, with its own page buttons when it needs them. */
function Paged<T>(props: {
  items: T[];
  size: number;
  children: (rows: T[]) => JSX.Element;
}): JSX.Element {
  const [p, setP] = createSignal(0);
  const pages = () => Math.max(1, Math.ceil(props.items.length / props.size));
  const page = () => Math.min(p(), pages() - 1);
  return (
    <>
      {props.children(props.items.slice(page() * props.size, (page() + 1) * props.size))}
      <Show when={pages() > 1}>
        <Pager
          page={page()}
          pages={pages()}
          size={props.size}
          n={props.items.length}
          onPage={setP}
        />
      </Show>
    </>
  );
}

/** Percentile with linear interpolation, like numpy's default. */
function percentile(sorted: number[], q: number): number {
  const pos = (q / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (pos - lo);
}

/**
 * Observed auROC against the auROC of the time-shifted data. Bars, reference lines, the observed line and its label
 * all use one x scale, and the label flips to the left of the line near the right edge so it is never cut off.
 */
/** A box that fills its space and draws its child at the box's pixel size, so text keeps its size. */
export function Fit(props: { height?: number; children: (w: number, h: number) => JSX.Element }): JSX.Element {
  const [size, measure] = createSize();
  return (
    <div
      class="cb-ar-fit"
      classList={{ 'cb-ar-fit--fill': props.height === undefined }}
      style={props.height ? { height: `${props.height}px` } : undefined}
      ref={measure}
    >
      <Show when={size().w > 0 && size()} keyed>
        {(s) => props.children(s.w, s.h)}
      </Show>
    </div>
  );
}

function ShiftHistogram(props: {
  draws: number[];
  observed: number;
  alpha: number;
  w?: number;
  h?: number;
}): JSX.Element {
  const [W, H, L, R, T, B] = [props.w ?? 560, props.h ?? 230, 12, 16, 28, 36];
  const finite = () => props.draws.filter(Number.isFinite).sort((a, b) => a - b);
  const domain = (): [number, number] => {
    const f = finite();
    const lo = Math.min(f[0] ?? 0.5, props.observed, 0.5);
    const hi = Math.max(f[f.length - 1] ?? 0.5, props.observed, 0.5);
    const pad = (hi - lo) * 0.06 || 0.05;
    return [lo - pad, hi + pad];
  };
  const x = (v: number) => L + ((v - domain()[0]) / (domain()[1] - domain()[0])) * (W - L - R);
  const bins = createMemo(() => {
    const NB = 40;
    const [lo, hi] = domain();
    const counts = new Array<number>(NB).fill(0);
    for (const v of finite()) counts[Math.min(NB - 1, Math.floor(((v - lo) / (hi - lo)) * NB))]++;
    return { counts, w: (hi - lo) / NB, max: Math.max(1, ...counts) };
  });
  const y = (c: number) => T + (1 - c / bins().max) * (H - T - B);
  const ref = () => {
    const f = finite();
    return f.length
      ? ([
          percentile(f, (100 * props.alpha) / 2),
          percentile(f, 100 - (100 * props.alpha) / 2),
        ] as const)
      : undefined;
  };
  const ticks = () => {
    const [lo, hi] = domain();
    const step = hi - lo > 0.5 ? 0.1 : hi - lo > 0.25 ? 0.05 : 0.02;
    const out: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(+v.toFixed(3));
    return out;
  };
  const flip = () => x(props.observed) > W * 0.7;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      class="cb-auroc-hist"
      role="img"
      aria-label={`Observed auROC ${num(props.observed)} against ${finite().length} time-shifted values`}
    >
      <Show when={ref()}>
        {(r) => (
          <rect x={x(r()[0])} y={T} width={x(r()[1]) - x(r()[0])} height={H - T - B} fill="#8884" />
        )}
      </Show>
      <For each={bins().counts}>
        {(c, i) => (
          <rect
            x={x(domain()[0] + i() * bins().w) + 0.5}
            y={y(c)}
            width={Math.max(1, x(domain()[0] + bins().w) - x(domain()[0]) - 1)}
            height={H - B - y(c)}
            fill="#9a9a9a"
          />
        )}
      </For>
      <Show when={ref()}>
        {(r) => (
          <>
            <line
              x1={x(r()[0])}
              x2={x(r()[0])}
              y1={T}
              y2={H - B}
              stroke="#555"
              stroke-dasharray="4 3"
            />
            <line
              x1={x(r()[1])}
              x2={x(r()[1])}
              y1={T}
              y2={H - B}
              stroke="#555"
              stroke-dasharray="4 3"
            />
          </>
        )}
      </Show>
      <line
        x1={x(props.observed)}
        x2={x(props.observed)}
        y1={T - 4}
        y2={H - B}
        stroke="#e8851a"
        stroke-width="3"
      />
      <text
        x={x(props.observed) + (flip() ? -6 : 6)}
        y={T - 10}
        text-anchor={flip() ? 'end' : 'start'}
        font-size="13"
        font-weight="600"
        fill="#c56a0a"
      >
        Observed {num(props.observed)}
      </text>
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="#999" />
      <For each={ticks()}>
        {(v) => (
          <text x={x(v)} y={H - B + 16} text-anchor="middle" font-size="12" fill="currentColor">
            {v}
          </text>
        )}
      </For>
      <text x={(L + W - R) / 2} y={H - 4} text-anchor="middle" font-size="12" fill="currentColor">
        auROC of time-shifted data
      </text>
    </svg>
  );
}

/**
 * auROC of one cell for each listed behavior on the 0 to 1 axis; filled when significant. Dots only: the
 * framework does not compute intervals for auROC. Row, dot and text share one row position.
 */
function Lollipops(props: { out: AurocOutcome; c: number; rows: number[]; w: number }): JSX.Element {
  const [W, R, ROW] = [props.w, 24, 24];
  const L = Math.min(150, Math.round(W * 0.4));
  const fit = (t: string) => {
    const n = Math.floor((L - 14) / 7);
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  const x = (v: number) => L + v * (W - L - R);
  return (
    <svg
      viewBox={`0 0 ${W} ${props.rows.length * ROW + 26}`}
      width={W}
      height={props.rows.length * ROW + 26}
      class="cb-auroc-lollipop"
      role="img"
      aria-label="auROC of this cell for each behavior"
    >
      <line x1={x(0.5)} x2={x(0.5)} y1={0} y2={props.rows.length * ROW} stroke="#999" />
      <For each={props.rows}>
        {(b, k) => {
          const a = () => aurocOf(props.out, props.c, b);
          const r = () => responseAt(props.out, props.c, b);
          const sig = () => r() === 'excited' || r() === 'inhibited';
          const color = () => (a() >= 0.5 ? '#e8851a' : '#6a3db8');
          const cy = ROW * k() + ROW / 2;
          return (
            <g>
              <text x={L - 10} y={cy + 4} text-anchor="end" font-size="12" fill="currentColor">
                <title>{props.out.labels[b]}</title>
                {fit(props.out.labels[b])}
              </text>
              <Show
                when={Number.isFinite(a())}
                fallback={
                  <text x={x(0.5) + 8} y={cy + 4} font-size="12" fill="currentColor">
                    Not evaluated
                  </text>
                }
              >
                <line
                  x1={x(0.5)}
                  x2={x(a())}
                  y1={cy}
                  y2={cy}
                  stroke={sig() ? color() : '#999'}
                  stroke-width="2.5"
                />
                <circle
                  cx={x(a())}
                  cy={cy}
                  r="6"
                  fill={sig() ? color() : 'var(--bg-primary, #fff)'}
                  stroke={sig() ? color() : '#777'}
                  stroke-width="2"
                />
              </Show>
            </g>
          );
        }}
      </For>
      <For each={[0, 0.5, 1]}>
        {(v) => (
          <text
            x={x(v)}
            y={props.rows.length * ROW + 18}
            text-anchor="middle"
            font-size="12"
            fill="currentColor"
          >
            {v}
          </text>
        )}
      </For>
    </svg>
  );
}

/** The cell's deconvolved events over the recording with the selected behavior's bouts and the excluded frames. */
function EventTrace(props: { out: AurocOutcome; c: number; b: number }): JSX.Element {
  const [W, H, TR] = [560, 110, 70];
  const input = () => props.out.input;
  const mat = () => deconvolved();
  const row = () => props.out.cellIds[props.c];
  const cols = createMemo(() => {
    const m = mat();
    if (!m || m.frames !== input().frames) return undefined;
    const v = m.data.subarray(row() * m.frames, (row() + 1) * m.frames);
    const n = v.length;
    let hi = 0;
    for (const x of v) if (Number.isFinite(x) && x > hi) hi = x;
    return Array.from({ length: W }, (_, k) => {
      let mx = 0;
      for (
        let t = Math.floor((k * n) / W);
        t < Math.max(Math.floor((k * n) / W) + 1, Math.floor(((k + 1) * n) / W));
        t++
      )
        if (Number.isFinite(v[t]) && v[t] > mx) mx = v[t];
      return hi > 0 ? mx / hi : 0;
    });
  });
  /** Runs of frames as [start, stop) in pixel columns, for frames where `on(t)` holds. */
  const runs = (on: (t: number) => boolean) => {
    const n = input().frames;
    const out: [number, number][] = [];
    for (let t = 0; t < n;) {
      if (!on(t)) {
        t++;
        continue;
      }
      let u = t;
      while (u < n && on(u)) u++;
      out.push([(t / n) * W, (u / n) * W]);
      t = u;
    }
    return out;
  };
  const bouts = createMemo(() =>
    runs((t) => input().behaviors[props.b * input().frames + t] === 1),
  );
  const gaps = createMemo(() => runs((t) => !input().mask[t]));
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      class="cb-auroc-trace"
      role="img"
      aria-label="Deconvolved events, behavior bars and excluded frames"
    >
      <Show
        when={cols()}
        fallback={
          <text x="4" y="20" font-size="12" fill="currentColor">
            No deconvolved events loaded for this recording.
          </text>
        }
      >
        <For each={cols()!}>
          {(v, k) => (
            <rect x={k()} y={TR - v * (TR - 4)} width="1" height={v * (TR - 4)} fill="#b87400" />
          )}
        </For>
      </Show>
      <For each={gaps()}>
        {([a, z]) => <rect x={a} y="0" width={Math.max(1, z - a)} height={TR} fill="#8884" />}
      </For>
      <For each={bouts()}>
        {([a, z]) => (
          <rect
            x={a}
            y={TR + 8}
            width={Math.max(1.5, z - a)}
            height="12"
            fill={behaviorColor(props.b)}
          />
        )}
      </For>
      <text x="0" y={H - 4} font-size="11" fill="currentColor">
        0 s
      </text>
      <text x={W} y={H - 4} text-anchor="end" font-size="11" fill="currentColor">
        {Math.round(input().frames / input().fs)} s
      </text>
      <text x={W / 2} y={H - 4} text-anchor="middle" font-size="11" fill="currentColor">
        Gray bands: excluded frames · Bar: {props.out.labels[props.b]}
      </text>
    </svg>
  );
}

/** What every view shares: the selected cell and behavior, and the filtered, sorted, paged cell list. */
interface Ctx {
  out: AurocOutcome;
  b: number;
  c: number;
  /** Cells passing the response filter and search, in the chosen order. */
  list: number[];
  /** Index of the selected cell in `list`, or -1 when it is filtered out. */
  pos: number;
  query: string;
  setQuery: (q: string) => void;
  sort: Sort;
  setSort: (s: Sort) => void;
  page: number;
  setPage: (p: number) => void;
  heatPage: number;
  setHeatPage: (p: number) => void;
  setC: (c: number) => void;
  setPair: (c: number, b: number) => void;
  step: (d: 1 | -1) => void;
  openInspector: () => void;
}

function Header(props: {
  out: AurocOutcome;
  onEdit: () => void;
  onDetails: () => void;
}): JSX.Element {
  const s = createMemo(() => summarize(props.out));
  const o = () => props.out;
  const method = () =>
    `${o().settings.method === 'speed' ? 'Speed-matched circular shift' : 'Circular shift'}, ${o().settings.nShuffles.toLocaleString()} shuffles`;
  const maxStat = () => o().settings.correction === 'max_stat';
  return (
    <>
      <div class="cb-ar-head">
        <div>
          <h2 class="cb-restitle">auROC results</h2>
          <p class="cb-muted">
            <b>
              {s().respondingCells} of {s().evaluated}
            </b>{' '}
            cells showed a significant response to at least one selected behavior · {s().significantPairs} significant
            cell–behavior pairs
          </p>
          <p class="cb-muted">
            {maxStat()
              ? `Max-stat correction across the ${o().labels.length} selected behaviors within each cell, not across cells`
              : 'No correction (uncorrected p-values)'}{' '}
            · α = {o().settings.alpha} · Completed in {Math.max(1, Math.round(o().seconds))} s · {method()}{' '}
            <InfoTip label="About the significance test and correction">
              <p>
                Significance compares the observed auROC with auROC values from time-shifted copies of the cell's neural
                data.
              </p>
              <p>
                {maxStat()
                  ? 'Max-stat correction accounts for testing the selected behaviors within each cell; it does not correct across cells. Adding or removing behaviors can change adjusted p-values.'
                  : 'No correction is applied: p-values are uncorrected for the number of behaviors and cells tested.'}
              </p>
            </InfoTip>
          </p>
        </div>
        <div class="cb-controls">
          <button class="btn-secondary" aria-haspopup="dialog" onClick={props.onDetails}>
            Run details
          </button>
          <button class="btn-secondary" onClick={props.onEdit}>
            Edit settings
          </button>
          <button
            class="btn-primary"
            onClick={() => {
              downloadText('auroc_pairs.csv', aurocCsv(o()), 'text/csv');
              downloadText(
                'auroc_run.json',
                JSON.stringify(aurocMetadata(o()), null, 2),
                'application/json',
              );
            }}
          >
            Export results
          </button>
        </div>
      </div>
      <div class="cb-ar-strip">
        <div>
          <strong class="cb-auroc-big">{s().respondingCells}</strong> / {s().evaluated} evaluated
          cells ({pct(s().respondingCells, s().evaluated)})
          <div class="cb-muted">
            Unique cells significant for at least one behavior · {s().missingCells} not evaluated
            <InfoTip label="Why a cell may not be evaluated">
              <p>
                auROC is left undefined, and the result is marked <strong>Not evaluated</strong>, in
                two cases:
              </p>
              <ul>
                <li>
                  <strong>Missing neural values:</strong> the cell has a missing value in any
                  included frame. All of its behaviors are not evaluated. {s().missingCells} cell
                  {s().missingCells === 1 ? '' : 's'} in this run.
                </li>
                <li>
                  <strong>Too few frames:</strong> a behavior has fewer than {MIN_FRAMES} included
                  frames during it or outside it. That behavior is not evaluated for any cell.
                  {s().tooFewFrames.length
                    ? ` In this run: ${s().tooFewFrames.join(', ')}.`
                    : ' None in this run.'}
                </li>
              </ul>
              <p>
                Not evaluated is not zero and not nonsignificant. These results are left out of the
                evaluated-cell and evaluated-pair counts.
              </p>
            </InfoTip>
          </div>
        </div>
        <div>
          <strong class="cb-auroc-big">{s().significantPairs}</strong> / {s().evaluatedPairs}{' '}
          evaluated pairs ({pct(s().significantPairs, s().evaluatedPairs)})
          <div class="cb-muted">
            Cell–behavior pairs · ▲ {s().excited} higher · ▼ {s().inhibited} lower
          </div>
        </div>
        <p class="cb-muted cb-ar-strip__note">
          Significant = adjusted p &lt; {o().settings.alpha}.{' '}
          {maxStat()
            ? `Max-stat correction across the ${o().labels.length} selected behaviors within each cell, not across cells.`
            : 'No correction for multiple comparisons.'}
        </p>
      </div>
    </>
  );
}

/** Search and sort for the shared cell list. */
function ListControls(props: { ctx: Ctx }): JSX.Element {
  return (
    <div class="cb-ar-listctl">
      <input
        class="cb-search"
        type="search"
        inputmode="numeric"
        placeholder="Search cell number"
        aria-label="Search cell number"
        value={props.ctx.query}
        onInput={(e) => props.ctx.setQuery(e.currentTarget.value.replace(/\D/g, ''))}
      />
      <select
        aria-label="Sort cells"
        value={props.ctx.sort}
        onChange={(e) => props.ctx.setSort(e.currentTarget.value as Sort)}
      >
        <option value="strength">Sort: Strongest for this behavior</option>
        <option value="auroc">Sort: auROC, high to low</option>
        <option value="cell">Sort: Cell number</option>
      </select>
    </div>
  );
}

const pagesOf = (n: number, size: number) => Math.max(1, Math.ceil(n / size));

function CellBrowser(props: { ctx: Ctx }): JSX.Element {
  const c = () => props.ctx;
  const o = () => c().out;
  const rows = () => c().list.slice(c().page * CELL_PAGE, (c().page + 1) * CELL_PAGE);
  return (
    <div class="cb-ar-browser">
      <ListControls ctx={c()} />
      <table class="cb-auroc-table cb-auroc-list">
        <thead>
          <tr>
            <th>Cell</th>
            <th>auROC</th>
            <th>Response</th>
          </tr>
        </thead>
        <tbody>
          <For each={rows()}>
            {(i) => (
              <tr
                classList={{ 'cb-row--on': i === c().c }}
                tabindex={i === c().c ? 0 : -1}
                aria-selected={i === c().c}
                onClick={() => c().setC(i)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && c().setC(i)}
              >
                <td>{o().cellIds[i] + 1}</td>
                <td>{num(aurocOf(o(), i, c().b))}</td>
                <td>
                  <Resp r={responseAt(o(), i, c().b)} />
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <Show when={!c().list.length}>
        <div class="cb-empty">No cells match this filter or search.</div>
      </Show>
      <Pager
        page={c().page}
        pages={pagesOf(c().list.length, CELL_PAGE)}
        size={CELL_PAGE}
        n={c().list.length}
        onPage={c().setPage}
      />
    </div>
  );
}

function Inspector(props: { ctx: Ctx }): JSX.Element {
  const c = () => props.ctx;
  const o = () => c().out;
  const [fp, setFp] = createSignal(false);
  const [big, setBig] = createSignal(false);
  const a = () => aurocOf(o(), c().c, c().b);
  const r = () => responseAt(o(), c().c, c().b);
  const draws = createMemo(() => {
    const nb = o().labels.length;
    const v = shiftedValues(o(), c().c);
    return Array.from({ length: o().shifts.length }, (_, i) => v[i * nb + c().b]);
  });
  const info = () => o().info[c().b];
  const cover = () => 100 * (1 - o().settings.alpha);
  const maxStat = () => o().settings.correction === 'max_stat';
  const rank = () => rankedCells(o()).indexOf(c().c) + 1;
  const cellName = () => `Cell ${o().cellIds[c().c] + 1}`;
  const sentence = () => {
    const cell = cellName();
    const against = o().against;
    const beh = against ? o().labels[c().b].split(' vs ')[0] : o().labels[c().b];
    const other = against ?? 'outside it';
    if (r() === 'excited')
      return `${cell} shows significantly higher activity during ${beh} than ${against ? 'during ' : ''}${other}.`;
    if (r() === 'inhibited')
      return `${cell} shows significantly lower activity during ${beh} than ${against ? 'during ' : ''}${other}.`;
    if (r() === 'not significant')
      return `${cell} does not differ significantly between ${beh} and ${against ?? 'the rest of the included frames'}.`;
    return o().cellsMissing.includes(c().c)
      ? `${cell} was not evaluated: it has a missing neural value among the included frames.`
      : `${cell} was not evaluated for ${o().labels[c().b]}: a group has fewer than ${MIN_FRAMES} included frames.`;
  };
  const hist = (w?: number, h?: number) => (
    <ShiftHistogram draws={draws()} observed={a()} alpha={o().settings.alpha} w={w} h={h} />
  );
  const histCaption = () => (
    <>
      Gray: {o().shifts.length.toLocaleString()} shifted copies, this behavior only, unadjusted.
      Dashed: their central {Math.round(cover())}%. Significance uses the{' '}
      {maxStat() ? 'max-stat adjusted' : 'unadjusted'} p.
    </>
  );
  return (
    <div class="cb-ar-insp">
      <CellBrowser ctx={c()} />
      <div class="cb-ar-detail">
        <div class="cb-ar-dhead">
          <h3>
            {cellName()} · {o().labels[c().b]} ·{' '}
            <span class="cb-muted">
              {info().during.toLocaleString()} behavior / {info().outside.toLocaleString()}{' '}
              {o().against ? `${o().against} ` : ''}reference frames
            </span>
          </h3>
          <div class="cb-controls">
            <button
              class="btn-secondary btn-small"
              aria-haspopup="dialog"
              onClick={() => setFp(true)}
            >
              Footprint and activity ↗
            </button>
            <button
              class="btn-secondary btn-small"
              aria-label="Previous cell"
              onClick={() => c().step(-1)}
            >
              ‹ Prev
            </button>
            <span class="cb-muted">
              {c().pos >= 0 ? c().pos + 1 : '–'} of {c().list.length}
            </span>
            <button
              class="btn-secondary btn-small"
              aria-label="Next cell"
              onClick={() => c().step(1)}
            >
              Next ›
            </button>
          </div>
        </div>
        <Show when={c().pos < 0}>
          <p class="cb-muted">This cell is hidden by the current filter or search.</p>
        </Show>
        <div class="cb-ar-stats">
          <div>
            <div class="cb-muted">
              auROC
              <InfoTip label="About auROC">
                The chance that a randomly chosen included frame during the behavior has a higher
                neural value than a randomly chosen reference frame (ties count half). 0.5 means no
                tendency; above 0.5 is higher during the behavior, below is lower.
              </InfoTip>
            </div>
            <strong class="cb-auroc-big">{num(a())}</strong>
          </div>
          <div>
            <div class="cb-muted">
              {maxStat() ? 'Adjusted p' : 'Uncorrected p'}
              <InfoTip label="About the p-value">
                Two-sided p-value from time-shifted copies of this cell’s neural data.{' '}
                {maxStat()
                  ? 'The adjusted value accounts for testing every selected behavior in this cell (max-stat), not for testing many cells.'
                  : 'No correction was applied: this is the uncorrected p-value.'}{' '}
                Significant when below α = {o().settings.alpha}.
              </InfoTip>
            </div>
            <strong class="cb-auroc-big">{num(pAdjOf(o(), c().c, c().b))}</strong>{' '}
            <span class="cb-muted">raw p {num(pRawOf(o(), c().c, c().b))}</span>
          </div>
          <div>
            <div class="cb-muted">
              Response
              <InfoTip label="About the response labels">{RESPONSE_NOTE}</InfoTip>
            </div>
            <Resp r={r()} />
          </div>
        </div>
        <p class="cb-ar-sentence">
          {sentence()}{' '}
          <Show when={rank()}>
            <span class="cb-muted">
              {strength(o(), c().c) >= 0
                ? `Rank ${rank()} of ${o().cellIds.length} by strongest association.`
                : ''}
            </span>
          </Show>
        </p>
        <div class="cb-ar-plots">
          <section class="cb-ar-plot cb-ar-plot--hist">
            <div class="cb-ar-plot__head">
              <h4>Observed auROC vs time-shifted data</h4>
              <HowTo title="Observed auROC versus time-shifted data">
                <p>
                  The x axis is auROC. Gray bars count how many of the shifted copies of this cell’s
                  neural data gave each auROC value; the orange line is the observed auROC. Dashed
                  lines mark the central {Math.round(cover())}% of the shifted values, unadjusted.
                </p>
                <p>
                  This plot shows the unadjusted distribution for this behavior alone. With max-stat
                  correction, the adjusted p-value instead compares the observed value with the most
                  extreme shifted value across all selected behaviors within the cell, so an
                  observed line outside the dashed range can still be not significant. Significance
                  follows the adjusted p-value, not the dashed lines.
                </p>
                <p>
                  An observed line far from the gray bars means the cell’s relation to the behavior
                  is unlikely to be explained by its own slow signal changes alone.{' '}
                  {o().settings.nShuffles.toLocaleString()} shuffles, minimum shift {o().minShiftS}{' '}
                  s.
                </p>
              </HowTo>
              <button
                type="button"
                class="cb-ib"
                aria-label="Expand time-shift plot"
                title="Expand plot"
                disabled={!Number.isFinite(a())}
                onClick={() => setBig(true)}
              >
                ⤢
              </button>
            </div>
            <Show
              when={Number.isFinite(a())}
              fallback={
                <p class="cb-muted">
                  No observed auROC for this pair, so there is nothing to compare with the shifted
                  data.
                </p>
              }
            >
              <Fit>{(w, h) => hist(w, h)}</Fit>
              <div class="cb-muted cb-ar-caption">{histCaption()}</div>
            </Show>
          </section>
          <section class="cb-ar-plot cb-ar-plot--across">
            <div class="cb-ar-plot__head">
              <h4>This cell across behaviors</h4>
              <HowTo title="This cell across behaviors">
                <p>
                  Each row is one behavior. The dot shows auROC on a scale from 0 to 1; the line
                  starts at 0.5, which means no tendency. Right of 0.5 is higher activity during the
                  behavior, left is lower. Filled orange or purple dots are significant after
                  correction (higher, lower); open gray dots are not significant. Dots only: no
                  interval is computed for auROC.
                </p>
                <p>
                  The table gives the same values with the adjusted p-value and response. Behaviors
                  are listed a page at a time.
                </p>
                {RESPONSE_NOTE}
              </HowTo>
            </div>
            <Paged items={o().labels.map((_, b) => b)} size={6}>
              {(rows) => (
                <>
                  <Fit height={rows.length * 24 + 26}>
                    {(w) => <Lollipops out={o()} c={c().c} rows={rows} w={w} />}
                  </Fit>
                  <table class="cb-auroc-table cb-ar-across">
                    <thead>
                      <tr>
                        <th>Behavior</th>
                        <th>auROC</th>
                        <th>Adj. p</th>
                        <th>Response</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={rows}>
                        {(b) => (
                          <tr classList={{ 'cb-row--on': b === c().b }}>
                            <td>{o().labels[b]}</td>
                            <td>{num(aurocOf(o(), c().c, b))}</td>
                            <td>{num(pAdjOf(o(), c().c, b))}</td>
                            <td>
                              <Resp r={responseAt(o(), c().c, b)} />
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </>
              )}
            </Paged>
          </section>
        </div>
      </div>
      <Show when={fp()}>
        <Modal
          title={`Footprint and activity · ${cellName()} · ${o().labels[c().b]}`}
          onClose={() => setFp(false)}
        >
          <div class="cb-fpstrip__open">
            <Footprint cellRow={o().cellIds[c().c]} width={160} />
            <div class="cb-fpstrip__main">
              <EventTrace out={o()} c={c().c} b={c().b} />
            </div>
          </div>
          <p class="cb-muted">
            Deconvolved events, behavior bars and excluded frames. The footprint is the cell’s
            spatial shape in the field of view. The trace shows its deconvolved events over the
            recording. The bar under it marks the selected behavior; gray bands mark frames excluded
            in Preprocess.
          </p>
        </Modal>
      </Show>
      <Show when={big()}>
        <Modal
          title={`Observed auROC vs time-shifted data · ${cellName()} · ${o().labels[c().b]}`}
          size="wide"
          onClose={() => setBig(false)}
        >
          {hist()}
          <div class="cb-muted">{histCaption()}</div>
        </Modal>
      </Show>
    </div>
  );
}

/**
 * The current page of the shared cell list (rows) by behaviors (columns). Rows, triangles, the selection outline
 * and the labels all come from one row-height scale, so each marker sits on its own cell.
 */
function Heatmap(props: { ctx: Ctx }): JSX.Element {
  const c = () => props.ctx;
  const o = () => c().out;
  const [contrast, setContrast] = createSignal(false);
  const [hover, setHover] = createSignal<[number, number] | undefined>();
  const order = () => c().list.slice(c().heatPage * HEAT_PAGE, (c().heatPage + 1) * HEAT_PAGE);
  const nb = () => o().labels.length;
  const [L, T, HEAD, RH] = [44, 8, 22, 14];
  const colW = () => Math.min(150, 520 / nb());
  const W = () => L + nb() * colW();
  const H = () => HEAD + T + order().length * RH + 4;
  const rowY = (i: number) => HEAD + T + i * RH;
  const range = (): [number, number] => (contrast() ? [0.25, 0.75] : [0, 1]);
  const sel = () => order().indexOf(c().c);
  const size = 10;
  const tip = () => {
    const h = hover();
    if (!h) return '';
    return `Cell ${o().cellIds[h[0]] + 1} · ${o().labels[h[1]]} · auROC ${num(aurocOf(o(), h[0], h[1]))} · adj. p ${num(pAdjOf(o(), h[0], h[1]))} · ${RESPONSE_LABEL[responseAt(o(), h[0], h[1])]}`;
  };
  const r = () => responseAt(o(), c().c, c().b);
  return (
    <div class="cb-auroc-heat cb-ar-heat">
      <div class="cb-ar-heat__main">
        <div class="cb-ar-plot__head">
          <h4>Cell responses across behaviors</h4>
          <HowTo title="Tuning heatmap">
            <p>
              Rows are cells in the order of the cell list (set by the response filter, search and
              sort) and columns are behaviors. Each square shows auROC for one cell and behavior:
              orange is higher during the behavior, purple is lower, gray is not evaluated.
              Triangles mark significant responses after correction (▲ higher, ▼ lower). The blue
              outline marks the selected cell and the highlighted column is the selected behavior.
            </p>
            <p>
              Scan across a row to compare one cell across behaviors, or down a column to compare
              cells for one behavior. Click a square to select that cell and behavior.
            </p>
            {RESPONSE_NOTE}
          </HowTo>
          <ListControls ctx={c()} />
        </div>
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
                  {(_, b) => {
                    const rr = () => responseAt(o(), cell, b());
                    const cx = () => L + colW() * (b() + 0.5);
                    const cy = () => rowY(i()) + RH / 2;
                    return (
                      <>
                        <rect
                          x={L + colW() * b() + 1}
                          y={rowY(i())}
                          width={colW() - 2}
                          height={RH}
                          fill={aurocColor(aurocOf(o(), cell, b()), ...range())}
                          onClick={() => c().setPair(cell, b())}
                          onMouseEnter={() => setHover([cell, b()])}
                          onMouseLeave={() => setHover(undefined)}
                        />
                        <Show when={rr() === 'excited' || rr() === 'inhibited'}>
                          <polygon
                            pointer-events="none"
                            fill="#111"
                            stroke="#fff"
                            stroke-width="0.6"
                            points={
                              rr() === 'excited'
                                ? `${cx()},${cy() - size / 2} ${cx() - size / 2},${cy() + size / 2} ${cx() + size / 2},${cy() + size / 2}`
                                : `${cx()},${cy() + size / 2} ${cx() - size / 2},${cy() - size / 2} ${cx() + size / 2},${cy() - size / 2}`
                            }
                          />
                        </Show>
                      </>
                    );
                  }}
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
        <div class="cb-muted" aria-live="polite">
          {tip() || 'Hover a square for its values; click to select it.'}
        </div>
        <Pager
          page={c().heatPage}
          pages={pagesOf(c().list.length, HEAT_PAGE)}
          size={HEAT_PAGE}
          n={c().list.length}
          onPage={c().setHeatPage}
        />
      </div>
      <div class="cb-ar-heat__side">
        <div class="cb-setgroup">
          <h4>Selected pair</h4>
          <div>
            <strong>{`Cell ${o().cellIds[c().c] + 1}`}</strong> · {o().labels[c().b]}
          </div>
          <div class="cb-ar-stats">
            <div>
              <div class="cb-muted">auROC</div>
              <strong class="cb-auroc-big">{num(aurocOf(o(), c().c, c().b))}</strong>
            </div>
            <div>
              <div class="cb-muted">{o().settings.correction === 'max_stat' ? 'Adjusted p' : 'Uncorrected p'}</div>
              <strong class="cb-auroc-big">{num(pAdjOf(o(), c().c, c().b))}</strong>
            </div>
          </div>
          <Resp r={r()} />{' '}
          <button class="btn-secondary btn-small" onClick={c().openInspector}>
            Open in cell inspector
          </button>
        </div>
        <AurocScale />
        <div class="cb-setting">
          <div class="cb-seg" role="group" aria-label="Color range">
            <button
              classList={{ 'cb-seg__on': !contrast() }}
              aria-pressed={!contrast()}
              onClick={() => setContrast(false)}
            >
              Range 0–1
            </button>
            <button
              classList={{ 'cb-seg__on': contrast() }}
              aria-pressed={contrast()}
              onClick={() => setContrast(true)}
            >
              Contrast 0.25–0.75
            </button>
          </div>
          <InfoTip label="About the color range">
            Lower during behavior (purple) to higher during behavior (orange).
            {contrast()
              ? ' Under higher contrast, values beyond the limits share the endpoint colors.'
              : ' Higher contrast limits the scale to 0.25–0.75; values beyond share the endpoint colors.'}
          </InfoTip>
        </div>
        <div class="cb-muted">
          ▲ Higher (excited) · ▼ Lower (inhibited), significant only · Gray: not evaluated
        </div>
        <div class="cb-setgroup">
          <h4>Included frames by behavior</h4>
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
        </div>
      </div>
    </div>
  );
}

function BehaviorSummary(props: { out: AurocOutcome }): JSX.Element {
  const s = createMemo(() => summarize(props.out));
  const COLORS: Record<string, string> = {
    excited: '#e8851a',
    inhibited: '#6a3db8',
    'not significant': '#c9c9c9',
  };
  return (
    <div class="cb-ar-sum">
      <div class="cb-setgroup">
        <div class="cb-ar-plot__head">
          <h4>Responses by behavior</h4>
          <HowTo title="Responses by behavior">
            <p>
              Each bar is one behavior and sums to 100% of the cells evaluated for it. Orange and
              purple segments are cells with a significant higher or lower response after
              correction; gray segments are not significant. Cells are counted once per behavior, so
              one cell can appear in several bars. Cells not evaluated for a behavior are left out
              of its percentages.
            </p>
          </HowTo>
        </div>
        <p class="cb-muted">Share of evaluated cells.</p>
        <Paged items={s().perBehavior} size={7}>
          {(rows) => (
            <For each={rows}>
              {(b) => {
                const total = () =>
                  b.counts.excited + b.counts.inhibited + b.counts['not significant'];
                return (
                  <div class="cb-auroc-bar">
                    <span>{b.label}</span>
                    <div
                      class="cb-auroc-bar__track"
                      role="img"
                      aria-label={`${b.label}: ${b.counts.excited} higher, ${b.counts.inhibited} lower, ${b.counts['not significant']} not significant`}
                    >
                      <For each={['excited', 'inhibited', 'not significant'] as const}>
                        {(r) => (
                          <i
                            style={{
                              width: `${total() ? (100 * b.counts[r]) / total() : 0}%`,
                              background: COLORS[r],
                            }}
                          />
                        )}
                      </For>
                    </div>
                    <span class="cb-muted">
                      {pct(b.counts.excited, total())} ▲ · {pct(b.counts.inhibited, total())} ▼ ·{' '}
                      {b.counts['not evaluated']} not evaluated
                    </span>
                  </div>
                );
              }}
            </For>
          )}
        </Paged>
        <div class="cb-muted">
          Orange: higher (excited) · Purple: lower (inhibited) · Gray: not significant
        </div>
      </div>
      <div>
        <div class="cb-setgroup">
          <div class="cb-ar-plot__head">
            <h4>Unique cells by number of significant behaviors</h4>
            <HowTo title="Unique cells by number of significant behaviors">
              <p>
                Each cell is counted once, by how many behaviors it responds to significantly. Cells
                with 0 are not responsive to any selected behavior; larger numbers suggest responses
                to several behaviors.
              </p>
            </HowTo>
          </div>
          <Paged items={s().bySignificantCount.map((n, k) => ({ n, k }))} size={5}>
            {(rows) => (
              <For each={rows}>
                {({ n, k }) => (
                  <div class="cb-auroc-bar">
                    <span>{k} significant</span>
                    <div class="cb-auroc-bar__track">
                      <i
                        style={{
                          width: `${s().evaluated ? (100 * n) / s().evaluated : 0}%`,
                          background: k ? '#1f6fb2' : '#c9c9c9',
                        }}
                      />
                    </div>
                    <span class="cb-muted">
                      {n} cells · {pct(n, s().evaluated)}
                    </span>
                  </div>
                )}
              </For>
            )}
          </Paged>
        </div>
        <div class="cb-setgroup">
          <h4>Response patterns</h4>
          <Show
            when={s().patterns.length}
            fallback={<p class="cb-muted">No cell responds significantly to a behavior.</p>}
          >
            <Paged items={s().patterns} size={5}>
              {(rows) => (
                <table class="cb-auroc-table">
                  <thead>
                    <tr>
                      <th>Pattern</th>
                      <th>Cells</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={rows}>
                      {(p) => (
                        <tr>
                          <td>{p.pattern}</td>
                          <td>{p.cells}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              )}
            </Paged>
          </Show>
          <div class="cb-muted">▲ higher (excited) · ▼ lower (inhibited)</div>
        </div>
      </div>
    </div>
  );
}

/** What a run used and chose. Read only: changes go through Edit settings and a new run. */
function RunDetails(props: { out: AurocOutcome; onClose: () => void }): JSX.Element {
  const o = () => props.out;
  const KV = (p: { k: string; v: JSX.Element }) => (
    <div class="cb-kv">
      <span>{p.k}</span>
      <span>{p.v}</span>
    </div>
  );
  const kept = () => o().input.mask.reduce((a, b) => a + b, 0);
  const m = () => o().matched;
  return (
    <Modal title="Run details" onClose={props.onClose}>
      <p class="cb-muted">Settings and automatic choices. Use Edit settings to change them.</p>
      <div class="cb-ar-cols">
        <section>
          <h4>Inputs</h4>
          <KV
            k="Neural signal"
            v={`Deconvolved events, Gaussian smoothing σ = ${o().prep.eventSigmaS} s`}
          />
          <KV k="Cells analyzed" v={o().cellIds.length.toLocaleString()} />
          <KV k="Frames in recording" v={o().input.frames.toLocaleString()} />
          <KV k="Sampling rate" v={`${num(o().input.fs, 2)} Hz`} />
        </section>
        <section>
          <h4>Preprocessing</h4>
          <KV
            k="Included frames"
            v={`${kept().toLocaleString()} of ${o().input.frames.toLocaleString()}`}
          />
          <KV
            k="Minimum speed (auROC)"
            v={o().excluded.minSpeed !== undefined ? `${o().excluded.minSpeed} cm/s` : 'No speed filter'}
          />
          <KV
            k="Excluded: missing speed"
            v={o().excluded.minSpeed !== undefined ? o().excluded.missingSpeed.toLocaleString() : '—'}
          />
          <KV
            k="Excluded: below minimum speed"
            v={o().excluded.minSpeed !== undefined ? o().excluded.slow.toLocaleString() : '—'}
          />
          <button class="cb-link" onClick={() => goToStep('prep')}>
            Edit frame selection in Preprocess
          </button>
        </section>
        <section>
          <h4>Comparison</h4>
          <KV k="Reference group" v={o().against ?? 'All other included frames'} />
          <For each={o().info}>
            {(i) => (
              <KV
                k={i.label}
                v={`${i.during.toLocaleString()} during / ${i.outside.toLocaleString()} outside`}
              />
            )}
          </For>
        </section>
        <section>
          <h4>Statistical settings</h4>
          <KV
            k="Method"
            v={o().settings.method === 'speed' ? 'Speed-matched circular shift' : 'Circular shift'}
          />
          <KV
            k="Minimum shift"
            v={`${o().minShiftS} s${o().timescale ? ' (auto)' : ' (manual)'}`}
          />
          <KV k="Shuffles" v={o().settings.nShuffles.toLocaleString()} />
          <KV k="Unique shifts" v={o().uniqueShifts.toLocaleString()} />
          <KV k="Random seed" v={o().settings.seed} />
          <KV k="Significance level" v={`α = ${o().settings.alpha} (two-sided, ${o().settings.correction === 'max_stat' ? 'adjusted' : 'uncorrected'} p)`} />
          <Show when={o().uniqueShifts < o().settings.nShuffles}>
            <p class="cb-muted">
              Only {o().uniqueShifts.toLocaleString()} unique shifts met the criteria; accepted
              shifts were reused to generate {o().settings.nShuffles.toLocaleString()} shuffled
              samples. Repeated shifts limit the diversity of the reference distribution.
            </p>
          </Show>
        </section>
        <section>
          <h4>Correction</h4>
          <KV k="Correction" v={o().settings.correction === 'max_stat' ? 'Max-stat' : 'None'} />
          <KV
            k="Scope"
            v={
              o().settings.correction === 'max_stat'
                ? `Across the ${o().labels.length} selected behaviors within each cell, not across cells`
                : 'No correction for multiple comparisons'
            }
          />
        </section>
        <Show when={m()}>
          {(d) => (
            <section>
              <h4>Speed matching</h4>
              <KV
                k="Balance measure"
                v={o().settings.match.statistic === 'ks' ? 'KS distance' : 'Difference in means'}
              />
              <KV k="Tolerance" v={o().settings.match.tolerance} />
              <KV k="Candidates per shift" v={o().settings.match.maxTries} />
              <KV k="Candidates examined" v={d().candidates.toLocaleString()} />
              <KV k="Acceptance rate" v={pct(d().unique, d().candidates)} />
              <KV k="Unique accepted shifts" v={d().unique.toLocaleString()} />
              <KV k="Largest balance statistic accepted" v={num(d().balanceMax)} />
              <KV k="Mean worst-behavior statistic" v={num(d().balanceMean)} />
              <p class="cb-muted">
                KS distance, tolerance 0.10 and 20 candidates per shift are framework starting
                settings, not validated standards.
              </p>
            </section>
          )}
        </Show>
        <section>
          <h4>Not evaluated</h4>
          <KV
            k="Cells with missing neural values"
            v={
              o().cellsMissing.length
                ? o()
                    .cellsMissing.map((c) => o().cellIds[c] + 1)
                    .join(', ')
                : 'None'
            }
          />
          <KV
            k={`Behaviors with fewer than ${MIN_FRAMES} frames`}
            v={summarize(o()).tooFewFrames.join(', ') || 'None'}
          />
        </section>
        <Show when={o().timescale}>
          {(t) => (
            <section>
              <h4>Calculation details</h4>
              <div class="cb-muted">
                <p>
                  Neural data decorrelates in {num(t().tauNeuralS, 2)} s (median over cells) and
                  behavior in {num(t().tauBehaviorS, 2)} s. {t().note}.
                </p>
                <p>
                  The shifted values for a cell are recomputed from the stored shifts, seed, frame
                  selection and neural data, so they are the draws the p-values came from.
                </p>
              </div>
            </section>
          )}
        </Show>
      </div>
      <button
        class="btn-secondary"
        onClick={() =>
          downloadText(
            'auroc_run.json',
            JSON.stringify(aurocMetadata(o()), null, 2),
            'application/json',
          )
        }
      >
        Export run metadata
      </button>
    </Modal>
  );
}

export function AurocResults(props: { out: AurocOutcome; onEdit: () => void }): JSX.Element {
  const o = () => props.out;
  // Selection, filters and pages live here, so no overlay or view loses them when it opens or closes.
  const [view, setView] = createSignal<View>('inspector');
  const [details, setDetails] = createSignal(false);
  const [b, setB] = createSignal(0);
  const [c, setC] = createSignal(rankedCells(props.out)[0] ?? 0);
  const [filter, setFilter] = createSignal<Filter>('all');
  const [query, setQuery] = createSignal('');
  const [sort, setSort] = createSignal<Sort>('strength');
  const [page, setPage] = createSignal(0);
  const [heatPage, setHeatPage] = createSignal(0);

  const ranked = createMemo(() => rankedCells(o()));
  const counts = createMemo(() => {
    const n = { all: o().cellIds.length } as Record<Filter, number>;
    for (const r of RESPONSES) n[r] = 0;
    for (let i = 0; i < o().cellIds.length; i++) n[responseAt(o(), i, b())]++;
    return n;
  });
  const list = createMemo(() => {
    let l = ranked().filter((i) => filter() === 'all' || responseAt(o(), i, b()) === filter());
    const q = query().trim();
    if (q) l = l.filter((i) => String(o().cellIds[i] + 1).startsWith(q));
    const a = (i: number) => aurocOf(o(), i, b());
    if (sort() === 'strength')
      l = [...l].sort((x, y) => (Math.abs(a(y) - 0.5) || -1) - (Math.abs(a(x) - 0.5) || -1));
    if (sort() === 'cell') l = [...l].sort((x, y) => x - y);
    if (sort() === 'auroc') l = [...l].sort((x, y) => (a(y) || -1) - (a(x) || -1));
    return l;
  });
  const pos = () => list().indexOf(c());
  // A new selection, filter or sort turns each list to the selected cell's page, or keeps it in range.
  createEffect(
    on([list, c], () => {
      const p = pos();
      const n = list().length;
      setPage(p >= 0 ? Math.floor(p / CELL_PAGE) : (v) => Math.min(v, pagesOf(n, CELL_PAGE) - 1));
      setHeatPage(
        p >= 0 ? Math.floor(p / HEAT_PAGE) : (v) => Math.min(v, pagesOf(n, HEAT_PAGE) - 1),
      );
    }),
  );
  const step = (d: 1 | -1) => {
    const l = list();
    if (!l.length) return;
    const p = pos();
    setC(l[p < 0 ? (d > 0 ? 0 : l.length - 1) : Math.min(l.length - 1, Math.max(0, p + d))]);
  };

  const ctx: Ctx = {
    get out() {
      return props.out;
    },
    get b() {
      return b();
    },
    get c() {
      return c();
    },
    get list() {
      return list();
    },
    get pos() {
      return pos();
    },
    get query() {
      return query();
    },
    setQuery,
    get sort() {
      return sort();
    },
    setSort,
    get page() {
      return page();
    },
    setPage,
    get heatPage() {
      return heatPage();
    },
    setHeatPage,
    setC,
    setPair: (cell, beh) => {
      setC(cell);
      setB(beh);
    },
    step,
    openInspector: () => setView('inspector'),
  };

  let root!: HTMLDivElement;
  onMount(() => onCleanup(fitToWindow(root)));
  const cellView = () => view() !== 'summary';
  return (
    <div class="cb-results cb-ar" ref={root}>
      <Header out={props.out} onEdit={props.onEdit} onDetails={() => setDetails(true)} />
      <div class="cb-ar-tool">
        <div class="cb-seg" role="group" aria-label="Results view">
          <For each={VIEWS}>
            {([id, label]) => (
              <button
                classList={{ 'cb-seg__on': view() === id }}
                aria-pressed={view() === id}
                onClick={() => setView(id)}
              >
                {label}
              </button>
            )}
          </For>
        </div>
        <label class="cb-sortpick">
          Behavior
          <select
            value={b()}
            disabled={!cellView()}
            title={cellView() ? undefined : 'Not used in the behavior summary'}
            onChange={(e) => setB(+e.currentTarget.value)}
          >
            <For each={o().labels}>{(l, i) => <option value={i()}>{l}</option>}</For>
          </select>
        </label>
        <label class="cb-sortpick">
          Response
          <select
            aria-label="Filter cells by response"
            value={filter()}
            disabled={!cellView()}
            title={cellView() ? undefined : 'Not used in the behavior summary'}
            onChange={(e) => setFilter(e.currentTarget.value as Filter)}
          >
            <For each={['all', ...RESPONSES] as Filter[]}>
              {(f) => (
                <option value={f}>
                  {f === 'all' ? 'All' : RESPONSE_LABEL[f]} ({counts()[f]})
                </option>
              )}
            </For>
          </select>
        </label>
      </div>
      <div class="cb-ar-view">
        <Show when={view() === 'inspector'}>
          <Inspector ctx={ctx} />
        </Show>
        <Show when={view() === 'heatmap'}>
          <Heatmap ctx={ctx} />
        </Show>
        <Show when={view() === 'summary'}>
          <BehaviorSummary out={props.out} />
        </Show>
      </div>
      <Show when={details()}>
        <RunDetails out={props.out} onClose={() => setDetails(false)} />
      </Show>
    </div>
  );
}
