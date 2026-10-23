import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { MIN_FRAMES, type Response } from '../lib/auroc.ts';
import { aurocCsv, aurocMetadata } from '../lib/auroc-export.ts';
import { shiftedValues, type AurocOutcome } from '../lib/auroc-run.ts';
import {
  aurocColor,
  aurocOf,
  pAdjOf,
  rankedCells,
  responseAt,
  RESPONSES,
  RESPONSE_LABEL,
  strength,
  summarize,
} from '../lib/auroc-view.ts';
import { downloadText } from '../lib/place-export.ts';
import { deconvolved, goToStep } from '../lib/store.ts';
import { prep } from '../lib/preprocess.ts';
import { Footprint } from './FootprintStrip.tsx';
import { HowToRead, Note } from './parts.tsx';
import { AurocScale, behaviorColor } from './AurocPanel.tsx';

type Tab = 'inspector' | 'heatmap' | 'summary';
const TABS: [Tab, string][] = [
  ['inspector', 'Cell inspector'],
  ['heatmap', 'Tuning heatmap'],
  ['summary', 'Behavior summary'],
];
const MARK: Partial<Record<Response, string>> = { excited: '▲', inhibited: '▼' };
const num = (v: number, d = 3) => (Number.isNaN(v) ? '–' : v.toFixed(d));
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '–');

const RESPONSE_NOTE = (
  <Note>
    <p>
      A cell-behavior pair is <strong>Excited</strong> when the adjusted p-value is below α and
      auROC is above 0.5, and <strong>Inhibited</strong> when it is below α and auROC is below 0.5.
      Otherwise it is <strong>Not significant</strong>. <strong>Not evaluated</strong> means auROC
      was undefined: the cell has a missing neural value among the included frames, or the behavior
      has fewer than {MIN_FRAMES} included frames during or outside it.
    </p>
    <p>
      Not significant is not evidence of no relationship. Direction alone does not establish
      significance; triangles and labels follow the adjusted p-value, never color.
    </p>
  </Note>
);

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
function ShiftHistogram(props: { draws: number[]; observed: number; alpha: number }): JSX.Element {
  const [W, H, L, R, T, B] = [560, 230, 12, 16, 28, 36];
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

/** auROC of one cell for each behavior on the 0 to 1 axis; filled when significant. Row, dot and text share one row position. */
function Lollipops(props: { out: AurocOutcome; c: number }): JSX.Element {
  const [W, L, R, ROW] = [560, 130, 190, 30];
  const nb = () => props.out.labels.length;
  const x = (v: number) => L + v * (W - L - R);
  return (
    <svg
      viewBox={`0 0 ${W} ${nb() * ROW + 28}`}
      class="cb-auroc-lollipop"
      role="img"
      aria-label="auROC of this cell for each behavior"
    >
      <line x1={x(0.5)} x2={x(0.5)} y1={0} y2={nb() * ROW} stroke="#999" />
      <For each={props.out.labels}>
        {(label, b) => {
          const a = () => aurocOf(props.out, props.c, b());
          const r = () => responseAt(props.out, props.c, b());
          const sig = () => r() === 'excited' || r() === 'inhibited';
          const color = () => (a() >= 0.5 ? '#e8851a' : '#6a3db8');
          const cy = ROW * b() + ROW / 2;
          return (
            <g>
              <text x={L - 10} y={cy + 4} text-anchor="end" font-size="12" fill="currentColor">
                {label}
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
                <text x={W - R + 12} y={cy + 4} font-size="12" fill="currentColor">
                  {num(a())} · adj. p {num(pAdjOf(props.out, props.c, b()))}
                  {MARK[r()] ? ` ${MARK[r()]} ${RESPONSE_LABEL[r()]}` : ''}
                </text>
              </Show>
            </g>
          );
        }}
      </For>
      <For each={[0, 0.5, 1]}>
        {(v) => (
          <text
            x={x(v)}
            y={nb() * ROW + 18}
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

function Header(props: {
  out: AurocOutcome;
  onEdit: () => void;
  onDetails: () => void;
}): JSX.Element {
  const s = createMemo(() => summarize(props.out));
  const o = () => props.out;
  return (
    <>
      <div class="cb-place-head">
        <div>
          <h2>auROC results</h2>
          <p class="cb-muted">
            Run complete · Completed in {Math.max(1, Math.round(o().seconds))} s · {s().cells} cells
            analyzed
          </p>
        </div>
        <div class="cb-controls">
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
      <div class="cb-auroc-summary">
        <div>
          <strong class="cb-auroc-big">{s().respondingCells}</strong> of {s().evaluated} evaluated
          cells respond significantly to at least one behavior
          <div class="cb-muted">
            {pct(s().respondingCells, s().evaluated)} of evaluated cells
            <Show when={s().missingCells}>
              {' · '}
              {s().missingCells} cell{s().missingCells === 1 ? '' : 's'} not evaluated
            </Show>
          </div>
        </div>
        <div>
          <strong class="cb-auroc-big">{s().significantPairs}</strong> significant cell–behavior
          pairs
          <div class="cb-muted">
            of {s().evaluatedPairs} evaluated pairs · {s().excited} excited · {s().inhibited}{' '}
            inhibited
          </div>
        </div>
        <button class="btn-secondary btn-small" onClick={props.onDetails}>
          Run details ›
        </button>
      </div>
      <p class="cb-muted">
        {o().settings.correction === 'max_stat'
          ? 'Max-stat correction across the selected behaviors within each cell (not across cells)'
          : 'No correction for multiple comparisons'}
        {' · '}Adjusted p &lt; {o().settings.alpha}
      </p>
      <details class="cb-notebox cb-howto">
        <summary>Why a cell may not be evaluated</summary>
        <div class="cb-muted">
          <p>
            auROC is left undefined, and the result is marked <strong>Not evaluated</strong>, in two
            cases:
          </p>
          <ul>
            <li>
              <strong>Missing neural values:</strong> the cell has a missing value in any included
              frame. All of its behaviors are not evaluated. {s().missingCells} cell
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
        </div>
      </details>
      <Show when={s().tooFewFrames.length}>
        <p class="cb-muted">
          Not tested (fewer than {MIN_FRAMES} frames): {s().tooFewFrames.join(', ')}
        </p>
      </Show>
    </>
  );
}

function Inspector(props: {
  out: AurocOutcome;
  c: number;
  b: number;
  setC: (c: number) => void;
  setB: (b: number) => void;
}): JSX.Element {
  const o = () => props.out;
  const [filter, setFilter] = createSignal<Response | 'all'>('all');
  const [query, setQuery] = createSignal('');
  const [sort, setSort] = createSignal<'strength' | 'auroc' | 'cell'>('strength');
  const ranked = createMemo(() => rankedCells(o()));
  const rank = () => ranked().indexOf(props.c) + 1;
  const counts = createMemo(() => {
    const c = { all: o().cellIds.length } as Record<Response | 'all', number>;
    for (const r of RESPONSES) c[r] = 0;
    for (let i = 0; i < o().cellIds.length; i++) c[responseAt(o(), i, props.b)]++;
    return c;
  });
  const list = createMemo(() => {
    let l = ranked().filter((i) => filter() === 'all' || responseAt(o(), i, props.b) === filter());
    const q = query().trim();
    if (q) l = l.filter((i) => String(o().cellIds[i] + 1).startsWith(q));
    const dev = (i: number) => Math.abs(aurocOf(o(), i, props.b) - 0.5);
    if (sort() === 'strength') l = [...l].sort((a, b) => (dev(b) || -1) - (dev(a) || -1));
    if (sort() === 'cell') l = [...l].sort((a, b) => a - b);
    if (sort() === 'auroc')
      l = [...l].sort(
        (a, b) => (aurocOf(o(), b, props.b) || -1) - (aurocOf(o(), a, props.b) || -1),
      );
    return l;
  });
  const step = (d: 1 | -1) => {
    const l = list();
    const p = l.indexOf(props.c);
    props.setC(l[Math.min(l.length - 1, Math.max(0, p + d))] ?? props.c);
  };
  const a = () => aurocOf(o(), props.c, props.b);
  const r = () => responseAt(o(), props.c, props.b);
  const draws = createMemo(() => {
    const nb = o().labels.length;
    const v = shiftedValues(o(), props.c);
    return Array.from({ length: o().shifts.length }, (_, i) => v[i * nb + props.b]);
  });
  const info = () => o().info[props.b];
  const sentence = () => {
    const cell = `Cell ${o().cellIds[props.c] + 1}`;
    const against = o().against;
    const beh = against ? o().labels[props.b].split(' vs ')[0] : o().labels[props.b];
    const other = against ?? 'outside it';
    if (r() === 'excited')
      return `${cell} shows significantly higher activity during ${beh} than ${against ? 'during ' : ''}${other}.`;
    if (r() === 'inhibited')
      return `${cell} shows significantly lower activity during ${beh} than ${against ? 'during ' : ''}${other}.`;
    if (r() === 'not significant')
      return `${cell} does not differ significantly between ${beh} and ${against ?? 'the rest of the included frames'}.`;
    return o().cellsMissing.includes(props.c)
      ? `${cell} was not evaluated: it has a missing neural value among the included frames.`
      : `${cell} was not evaluated for ${o().labels[props.b]}: a group has fewer than ${MIN_FRAMES} included frames.`;
  };
  return (
    <>
      <div class="cb-muted">Response to {o().labels[props.b]}</div>
      <div class="cb-controls" role="group" aria-label="Filter by response">
        <For each={['all', ...RESPONSES] as (Response | 'all')[]}>
          {(f) => (
            <button
              class="btn-secondary btn-small"
              classList={{ 'cb-seg__on': filter() === f }}
              aria-pressed={filter() === f}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All cells' : RESPONSE_LABEL[f]} {counts()[f]}
            </button>
          )}
        </For>
      </div>
      <div class="cb-cellgrid">
        <div>
          <input
            class="cb-search"
            type="search"
            placeholder="Search cell number"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            aria-label="Search cell number"
          />
          <select
            aria-label="Sort cells"
            value={sort()}
            onChange={(e) => setSort(e.currentTarget.value as 'strength')}
          >
            <option value="strength">Sort: Strongest for this behavior</option>
            <option value="auroc">Sort: auROC, high to low</option>
            <option value="cell">Sort: Cell number</option>
          </select>
          <table class="cb-auroc-table cb-auroc-list">
            <thead>
              <tr>
                <th>Cell</th>
                <th>auROC</th>
                <th>Response</th>
              </tr>
            </thead>
            <tbody>
              <For each={list().slice(0, 300)}>
                {(i) => (
                  <tr classList={{ 'cb-row--on': i === props.c }} onClick={() => props.setC(i)}>
                    <td>{o().cellIds[i] + 1}</td>
                    <td>{num(aurocOf(o(), i, props.b))}</td>
                    <td>
                      <span
                        class={`cb-resp cb-resp--${responseAt(o(), i, props.b).replace(' ', '-')}`}
                      >
                        {MARK[responseAt(o(), i, props.b)] ?? ''}{' '}
                        {RESPONSE_LABEL[responseAt(o(), i, props.b)]}
                      </span>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <Show when={list().length > 300}>
            <div class="cb-muted">
              Showing the first 300 of {list().length}. Search or filter to narrow.
            </div>
          </Show>
        </div>
        <div class="cb-setgroup">
          <div class="cb-place-head">
            <h3>
              Cell {o().cellIds[props.c] + 1}{' '}
              <span class="cb-muted">
                {rank() ? `Rank ${rank()} of ${o().cellIds.length} · ` : ''}
                {strength(o(), props.c) >= 0 ? 'Strongest association' : 'Not evaluated'}
              </span>
            </h3>
            <div class="cb-controls">
              <button
                class="btn-secondary btn-small"
                aria-label="Previous cell"
                onClick={() => step(-1)}
              >
                ‹
              </button>
              <button
                class="btn-secondary btn-small"
                aria-label="Next cell"
                onClick={() => step(1)}
              >
                ›
              </button>
            </div>
          </div>
          <div class="cb-seg" role="group" aria-label="Behavior">
            <For each={o().labels}>
              {(label, b) => (
                <button
                  classList={{ 'cb-seg__on': b() === props.b }}
                  aria-pressed={b() === props.b}
                  onClick={() => props.setB(b())}
                >
                  {label}
                </button>
              )}
            </For>
          </div>
          <div class="cb-auroc-stats">
            <div>
              <div class="cb-muted">auROC</div>
              <strong class="cb-auroc-big">{num(a())}</strong>
            </div>
            <div>
              <div class="cb-muted">Response</div>
              <span class={`cb-resp cb-resp--${r().replace(' ', '-')}`}>
                {MARK[r()] ?? ''} {RESPONSE_LABEL[r()]}
              </span>
            </div>
            <div>
              <div class="cb-muted">Adjusted p</div>
              <strong class="cb-auroc-big">{num(pAdjOf(o(), props.c, props.b))}</strong>
            </div>
          </div>
          <div class="cb-muted">
            Included frames: {o().against ? `${o().against} only` : 'during / outside'} ·{' '}
            {info().during.toLocaleString()} / {info().outside.toLocaleString()}
          </div>
          <p>{sentence()}</p>
          {RESPONSE_NOTE}
          <Show when={Number.isFinite(a())}>
            <h4>Observed auROC versus time-shifted data</h4>
            <div class="cb-muted">
              Cell {o().cellIds[props.c] + 1} · {o().labels[props.b]} ·{' '}
              {o().settings.nShuffles.toLocaleString()} shuffles · minimum shift {o().minShiftS} s
            </div>
            <ShiftHistogram draws={draws()} observed={a()} alpha={o().settings.alpha} />
            <div class="cb-muted">
              Gray bars: time-shifted data · Dashed lines: unadjusted{' '}
              {Math.round(100 * (1 - o().settings.alpha))}% reference interval · Orange line:
              observed auROC
            </div>
            <HowToRead>
              <p>
                Bars show auROC values from time-shifted data; the orange line marks the observed
                value. Dashed lines mark the unadjusted {Math.round(100 * (1 - o().settings.alpha))}
                % reference interval. Significance is determined by the adjusted p-value, not by the
                dashed lines.
              </p>
            </HowToRead>
          </Show>
          <h4>This cell across behaviors</h4>
          <Lollipops out={o()} c={props.c} />
          <div class="cb-muted">Filled: significant. Open: not significant.</div>
          <HowToRead>
            <p>
              Each row is one behavior. The dot shows auROC on a scale from 0 to 1; the line starts
              at 0.5, which means no tendency. Right of 0.5 is higher activity during the behavior,
              left is lower. Filled dots are significant after correction.
            </p>
          </HowToRead>
          <details class="cb-notebox">
            <summary>
              <strong>Footprint and event trace</strong> · Deconvolved events, behavior bars,
              excluded frames
            </summary>
            <div class="cb-fpstrip__open">
              <Footprint cellRow={o().cellIds[props.c]} width={120} />
              <div class="cb-fpstrip__main">
                <EventTrace out={o()} c={props.c} b={props.b} />
              </div>
            </div>
            <HowToRead>
              <p>
                The footprint is the cell’s spatial shape in the field of view. The trace shows its
                deconvolved events over the recording. The bar under it marks the selected behavior;
                gray bands mark frames excluded in Preprocess.
              </p>
            </HowToRead>
          </details>
        </div>
      </div>
    </>
  );
}

/**
 * Cells (rows, strongest first) by behaviors (columns). Rows, triangles, the selection outline and the rank labels all
 * come from one row-height scale, so each marker sits on its own cell.
 */
function Heatmap(props: {
  out: AurocOutcome;
  c: number;
  b: number;
  setPair: (c: number, b: number) => void;
}): JSX.Element {
  const o = () => props.out;
  const [contrast, setContrast] = createSignal(false);
  const [hover, setHover] = createSignal<[number, number] | undefined>();
  const order = createMemo(() => rankedCells(o()));
  const nb = () => o().labels.length;
  const [L, T, HEAD] = [44, 8, 22];
  const colW = () => Math.min(150, 560 / nb());
  const W = L + nb() * colW();
  const rh = () => Math.max(2, Math.min(14, 560 / order().length));
  const H = () => HEAD + T + order().length * rh() + 4;
  const rowY = (i: number) => HEAD + T + i * rh();
  const range = (): [number, number] => (contrast() ? [0.25, 0.75] : [0, 1]);
  const sel = () => order().indexOf(props.c);
  const tick = (n: number) =>
    [...new Set([1, Math.round(n / 3), Math.round((2 * n) / 3), n])].filter((v) => v >= 1);
  const size = () => Math.max(6, Math.min(rh() * 0.85, 10));
  const tip = () => {
    const h = hover();
    if (!h) return '';
    const r = responseAt(o(), h[0], h[1]);
    return `Cell ${o().cellIds[h[0]] + 1} · ${o().labels[h[1]]} · auROC ${num(aurocOf(o(), h[0], h[1]))} · adj. p ${num(pAdjOf(o(), h[0], h[1]))} · ${MARK[r] ?? ''} ${RESPONSE_LABEL[r]}`;
  };
  return (
    <div class="cb-auroc-heat">
      <div>
        <p class="cb-muted">
          Cells are ranked by their largest departure from 0.5 across the tested behaviors.
        </p>
        <h4>Cell responses across behaviors</h4>
        <p class="cb-muted">
          Each square shows auROC for one cell and behavior. Triangles mark significant responses
          after correction.
        </p>
        <svg
          viewBox={`0 0 ${W} ${H()}`}
          style={{ 'max-width': `${W}px` }}
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
                fill="currentColor"
              >
                {label}
              </text>
            )}
          </For>
          <For each={order()}>
            {(c, i) => (
              <For each={o().labels}>
                {(_, b) => (
                  <rect
                    x={L + colW() * b() + 1}
                    y={rowY(i())}
                    width={colW() - 2}
                    height={rh()}
                    fill={aurocColor(aurocOf(o(), c, b()), ...range())}
                    onClick={() => props.setPair(c, b())}
                    onMouseEnter={() => setHover([c, b()])}
                    onMouseLeave={() => setHover(undefined)}
                  />
                )}
              </For>
            )}
          </For>
          <For each={order()}>
            {(c, i) => (
              <For each={o().labels}>
                {(_, b) => {
                  const r = () => responseAt(o(), c, b());
                  const cx = () => L + colW() * (b() + 0.5);
                  const cy = () => rowY(i()) + rh() / 2;
                  return (
                    <Show when={MARK[r()]}>
                      <polygon
                        pointer-events="none"
                        fill="#111"
                        stroke="#fff"
                        stroke-width="0.6"
                        points={
                          r() === 'excited'
                            ? `${cx()},${cy() - size() / 2} ${cx() - size() / 2},${cy() + size() / 2} ${cx() + size() / 2},${cy() + size() / 2}`
                            : `${cx()},${cy() + size() / 2} ${cx() - size() / 2},${cy() - size() / 2} ${cx() + size() / 2},${cy() - size() / 2}`
                        }
                      />
                    </Show>
                  );
                }}
              </For>
            )}
          </For>
          <Show when={sel() >= 0}>
            <rect
              x={L}
              y={rowY(sel())}
              width={W - L}
              height={rh()}
              fill="none"
              stroke="#1f6fb2"
              stroke-width="1.5"
              pointer-events="none"
            />
          </Show>
          <For each={tick(order().length)}>
            {(n) => (
              <text
                x={L - 6}
                y={rowY(n - 1) + rh() / 2 + 4}
                text-anchor="end"
                font-size="11"
                fill="currentColor"
              >
                {n}
              </text>
            )}
          </For>
        </svg>
        <div class="cb-muted" aria-live="polite">
          {tip() || 'Hover a square for its values; click to select it.'}
        </div>
        <div class="cb-muted">Rows: cells, ranked (1 = strongest).</div>
        <AurocScale />
        <div class="cb-setting">
          <div class="cb-setting__title">Color range</div>
          <div class="cb-seg">
            <button classList={{ 'cb-seg__on': !contrast() }} onClick={() => setContrast(false)}>
              Full range: 0–1
            </button>
            <button classList={{ 'cb-seg__on': contrast() }} onClick={() => setContrast(true)}>
              Higher contrast: 0.25–0.75
            </button>
          </div>
          <div class="cb-muted">
            Lower during behavior (purple) to higher during behavior (orange).
            {contrast() &&
              ' Under higher contrast, values beyond the limits share the endpoint colors.'}
          </div>
        </div>
        <div class="cb-muted">
          ▲ Significant, higher (excited) · ▼ Significant, lower (inhibited) · Gray: not evaluated
        </div>
        {RESPONSE_NOTE}
        <HowToRead>
          <p>
            Rows represent cells and columns represent behaviors. Orange indicates higher activity
            during a behavior; purple indicates lower activity. Triangles mark significant responses
            after correction. Scan across a row to compare one cell across behaviors, or down a
            column to compare cells for one behavior.
          </p>
        </HowToRead>
      </div>
      <div>
        <div class="cb-setgroup">
          <h3>Selected pair</h3>
          <div class="cb-controls">
            <strong>Cell {o().cellIds[props.c] + 1}</strong>
            <select
              aria-label="Behavior"
              value={props.b}
              onChange={(e) => props.setPair(props.c, +e.currentTarget.value)}
            >
              <For each={o().labels}>{(l, i) => <option value={i()}>{l}</option>}</For>
            </select>
          </div>
          <div class="cb-muted">auROC</div>
          <strong class="cb-auroc-big">{num(aurocOf(o(), props.c, props.b))}</strong>
          <div>
            <span class={`cb-resp cb-resp--${responseAt(o(), props.c, props.b).replace(' ', '-')}`}>
              {MARK[responseAt(o(), props.c, props.b)] ?? ''}{' '}
              {RESPONSE_LABEL[responseAt(o(), props.c, props.b)]}
            </span>
          </div>
          <div class="cb-muted">Adjusted p = {num(pAdjOf(o(), props.c, props.b))}</div>
        </div>
        <div class="cb-setgroup">
          <h3>Data available by behavior</h3>
          <table class="cb-auroc-table">
            <thead>
              <tr>
                <th>Behavior</th>
                <th>During</th>
                <th>Outside</th>
              </tr>
            </thead>
            <tbody>
              <For each={o().info}>
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
          <div class="cb-muted">Included frames during and outside each behavior.</div>
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
    <div class="cb-setgroup">
      <h4>Responses by behavior</h4>
      <p class="cb-muted">
        Share of evaluated cells. Cells not evaluated for a behavior are left out of its
        percentages.
      </p>
      <For each={s().perBehavior}>
        {(b) => {
          const total = () => b.counts.excited + b.counts.inhibited + b.counts['not significant'];
          return (
            <div class="cb-auroc-bar">
              <span>{b.label}</span>
              <div
                class="cb-auroc-bar__track"
                role="img"
                aria-label={`${b.label}: ${b.counts.excited} excited, ${b.counts.inhibited} inhibited, ${b.counts['not significant']} not significant`}
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
      <div class="cb-muted">Orange: excited · Purple: inhibited · Gray: not significant</div>
      <HowToRead>
        <p>
          Each bar is one behavior and sums to 100% of the cells evaluated for it. Orange and purple
          segments are cells with a significant higher or lower response after correction. Cells are
          counted once per behavior, so one cell can appear in several bars.
        </p>
      </HowToRead>
      <h4>Unique cells by number of significant behaviors</h4>
      <For each={s().bySignificantCount}>
        {(n, k) => (
          <div class="cb-auroc-bar">
            <span>{k()} significant</span>
            <div class="cb-auroc-bar__track">
              <i
                style={{
                  width: `${s().evaluated ? (100 * n) / s().evaluated : 0}%`,
                  background: k() ? '#1f6fb2' : '#c9c9c9',
                }}
              />
            </div>
            <span class="cb-muted">
              {n} cells · {pct(n, s().evaluated)}
            </span>
          </div>
        )}
      </For>
      <HowToRead>
        <p>
          Each cell is counted once, by how many behaviors it responds to significantly. Cells with
          0 are not responsive to any selected behavior; larger numbers suggest responses to several
          behaviors.
        </p>
      </HowToRead>
      <h4>Response patterns</h4>
      <Show
        when={s().patterns.length}
        fallback={<p class="cb-muted">No cell responds significantly to a behavior.</p>}
      >
        <table class="cb-auroc-table">
          <thead>
            <tr>
              <th>Pattern</th>
              <th>Cells</th>
            </tr>
          </thead>
          <tbody>
            <For each={s().patterns.slice(0, 12)}>
              {(p) => (
                <tr>
                  <td>{p.pattern}</td>
                  <td>{p.cells}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
      <div class="cb-muted">▲ excited · ▼ inhibited</div>
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
    <aside
      class="cb-drawer"
      role="dialog"
      aria-label="Run details"
      onKeyDown={(e) => e.key === 'Escape' && props.onClose()}
    >
      <div class="cb-drawer__head">
        <h3>Run details</h3>
        <button class="cb-link" aria-label="Close run details" onClick={props.onClose}>
          ✕
        </button>
      </div>
      <p class="cb-muted">Settings and automatic choices. Use Edit settings to change them.</p>
      <section>
        <h4>Frames</h4>
        <KV k="Included" v={`${kept().toLocaleString()} of ${o().input.frames.toLocaleString()}`} />
        <KV k="Excluded: no position" v={o().excluded.noPosition.toLocaleString()} />
        <KV
          k="Excluded: below minimum speed"
          v={
            prep.minSpeed > 0
              ? `${o().excluded.slow.toLocaleString()} (${prep.minSpeed} cm/s)`
              : 'No speed filter'
          }
        />
        <button class="cb-link" onClick={() => goToStep('prep')}>
          Edit frame selection in Preprocess
        </button>
      </section>
      <section>
        <h4>Behaviors</h4>
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
        <h4>Comparison</h4>
        <KV k="Compared against" v={o().against ?? 'All other frames'} />
        <KV
          k="Method"
          v={o().settings.method === 'speed' ? 'Speed-matched circular shift' : 'Circular shift'}
        />
        <KV k="Minimum shift" v={`${o().minShiftS} s${o().timescale ? ' (auto)' : ' (manual)'}`} />
        <KV k="Shuffles" v={o().settings.nShuffles.toLocaleString()} />
        <KV k="Unique shifts" v={o().uniqueShifts.toLocaleString()} />
        <KV k="Random seed" v={o().settings.seed} />
        <KV
          k="Correction"
          v={
            o().settings.correction === 'max_stat'
              ? 'Max-stat, across behaviors within each cell'
              : 'None'
          }
        />
        <KV k="Significance level" v={`α = ${o().settings.alpha} (two-sided, adjusted p)`} />
        <Show when={o().uniqueShifts < o().settings.nShuffles}>
          <p class="cb-muted">
            Only {o().uniqueShifts.toLocaleString()} unique shifts met the criteria; accepted shifts
            were reused to generate {o().settings.nShuffles.toLocaleString()} shuffled samples.
            Repeated shifts limit the diversity of the reference distribution.
          </p>
        </Show>
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
          <details class="cb-notebox">
            <summary>Calculation details</summary>
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
          </details>
        )}
      </Show>
      <button
        class="btn-secondary cb-drawer__export"
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
    </aside>
  );
}

export function AurocResults(props: { out: AurocOutcome; onEdit: () => void }): JSX.Element {
  const [tab, setTab] = createSignal<Tab>('inspector');
  const [drawer, setDrawer] = createSignal(false);
  const [b, setB] = createSignal(0);
  const [c, setC] = createSignal(rankedCells(props.out)[0] ?? 0);
  const setPair = (cell: number, beh: number) => {
    setC(cell);
    setB(beh);
  };
  return (
    <>
      <Header out={props.out} onEdit={props.onEdit} onDetails={() => setDrawer(true)} />
      <div class="cb-tabs" role="tablist" aria-label="Results views">
        <For each={TABS}>
          {([id, label]) => (
            <button
              role="tab"
              aria-selected={tab() === id}
              classList={{ 'cb-tab--on': tab() === id }}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          )}
        </For>
      </div>
      <Show when={tab() === 'inspector'}>
        <Inspector out={props.out} c={c()} b={b()} setC={setC} setB={setB} />
      </Show>
      <Show when={tab() === 'heatmap'}>
        <Heatmap out={props.out} c={c()} b={b()} setPair={setPair} />
        <button class="btn-primary" onClick={() => setTab('inspector')}>
          Open in cell inspector
        </button>
      </Show>
      <Show when={tab() === 'summary'}>
        <BehaviorSummary out={props.out} />
      </Show>
      <Show when={drawer()}>
        <RunDetails out={props.out} onClose={() => setDrawer(false)} />
      </Show>
    </>
  );
}
