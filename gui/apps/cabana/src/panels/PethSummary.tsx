// PETH results, summary: counts per behavior as a table and stacked bars, and the latencies of significant cells.

import { createMemo, For, Show, type JSX } from 'solid-js';
import { binFrames, hasTest, summarize, timeDomain } from '../lib/peth-view.ts';
import type { PethOutcome } from '../lib/peth-run.ts';
import { Fit, HowTo } from './AurocResults.tsx';
import { niceTicks, ORANGE, PURPLE } from './PethPlots.tsx';
import { colorOf, Dot, DIRECTION_NOTE, LabelNote } from './PethShared.tsx';

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '–');
const LIGHT = '#c9c9c9';

/** Latencies of significant cells, one group of bars per behavior, on the time axis after the onset. */
function LatencyHist(props: { out: PethOutcome; w: number; h: number }): JSX.Element {
  const [L, R, T, B] = [44, 10, 8, 38];
  const o = () => props.out;
  const width = () => binFrames(o()) / o().input.fs;
  const hi = () => timeDomain(o())[1];
  const nb = () => Math.max(1, Math.ceil(hi() / width() - 1e-9));
  const groups = createMemo(() => {
    const rows = summarize(o()).perBehavior.map((p) => ({
      label: p.label,
      counts: (() => {
        const c = new Array<number>(nb()).fill(0);
        for (const l of [...p.latencies.higher, ...p.latencies.lower]) c[Math.min(nb() - 1, Math.floor(l / width()))]++;
        return c;
      })(),
    }));
    return rows.filter((r) => r.counts.some((n) => n));
  });
  const max = () => Math.max(1, ...groups().flatMap((g) => g.counts));
  const x = (t: number) => L + (t / hi()) * (props.w - L - R);
  const y = (n: number) => props.h - B - (n / max()) * (props.h - T - B);
  return (
    <svg width={props.w} height={props.h} viewBox={`0 0 ${props.w} ${props.h}`} role="img" aria-label="Latency of significant cells, by behavior">
      <For each={groups()}>
        {(g, gi) => (
          <For each={g.counts}>
            {(n, i) => (
              <rect
                x={x(i() * width()) + (gi() * (x(width()) - x(0))) / groups().length + 0.5}
                y={y(n)}
                width={Math.max(1, (x(width()) - x(0)) / groups().length - 1)}
                height={props.h - B - y(n)}
                fill={colorOf(g.label)}
                opacity="0.8"
              />
            )}
          </For>
        )}
      </For>
      <line x1={L} x2={props.w - R} y1={props.h - B} y2={props.h - B} stroke="#8c959f" />
      <For each={niceTicks(0, hi(), 8)}>
        {(t) => (
          <text x={x(t)} y={props.h - B + 14} font-size="11" fill="#666" text-anchor="middle">
            {t}
          </text>
        )}
      </For>
      <text x={(L + props.w - R) / 2} y={props.h - 4} font-size="11" fill="#666" text-anchor="middle">
        Latency after onset (s)
      </text>
      <line x1={L} x2={L} y1={T} y2={props.h - B} stroke="#8c959f" />
      <For each={niceTicks(0, max(), 4)}>
        {(v) => (
          <>
            <line x1={L - 4} x2={L} y1={y(v)} y2={y(v)} stroke="#8c959f" />
            <text x={L - 6} y={y(v) + 4} font-size="11" fill="#666" text-anchor="end">
              {v}
            </text>
          </>
        )}
      </For>
      <text transform={`translate(11 ${(T + props.h - B) / 2}) rotate(-90)`} font-size="11" fill="#666" text-anchor="middle">
        Cells
      </text>
    </svg>
  );
}

export function SummaryView(props: { out: PethOutcome }): JSX.Element {
  const o = () => props.out;
  const s = createMemo(() => summarize(o()));
  const labelled = () => hasTest(o());
  const nLatency = () => s().perBehavior.reduce((n, p) => n + p.latencies.higher.length + p.latencies.lower.length, 0);
  return (
    <div class="cb-pe-sum">
      <div class="cb-pe-col">
        <section class="cb-plot cb-plot--table cb-pe-sumtable">
          <div class="cb-plot__head">
            <h3>Response counts per behavior</h3>
          </div>
          <table class="cb-auroc-table cb-pe-tbl">
            <thead>
              <tr>
                <th>Behavior</th>
                <th class="cb-as-num">Onsets</th>
                <Show
                  when={labelled()}
                  fallback={<th class="cb-as-num">Evaluated cells</th>}
                >
                  <th class="cb-as-num">▲ Higher</th>
                  <th class="cb-as-num">▼ Lower</th>
                  <th class="cb-as-num">Not significant</th>
                  <th class="cb-as-num">Not evaluated</th>
                </Show>
              </tr>
            </thead>
            <tbody>
              <For each={s().perBehavior}>
                {(p) => {
                  const total = () => p.counts.excited + p.counts.inhibited + p.counts['not significant'];
                  return (
                    <tr classList={{ 'cb-muted': !!p.reason }}>
                      <td>
                        <Dot label={p.label} muted={!!p.reason} /> {p.label}
                      </td>
                      <td class="cb-as-num">{p.onsets}</td>
                      <Show
                        when={!p.reason}
                        fallback={<td colspan={labelled() ? 4 : 1}>Not evaluated: {p.reason}</td>}
                      >
                        <Show
                          when={labelled()}
                          fallback={<td class="cb-as-num">{s().cells - p.counts['not evaluated']}</td>}
                        >
                          <td class="cb-as-num">
                            {p.counts.excited} ({pct(p.counts.excited, total())})
                          </td>
                          <td class="cb-as-num">
                            {p.counts.inhibited} ({pct(p.counts.inhibited, total())})
                          </td>
                          <td class="cb-as-num">
                            {p.counts['not significant']} ({pct(p.counts['not significant'], total())})
                          </td>
                          <td class="cb-as-num">{p.counts['not evaluated']}</td>
                        </Show>
                      </Show>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
          <div class="cb-muted cb-pe-small">
            <Show when={labelled()} fallback="This run had no shuffle test, so there are no p-values and no labels.">
              Percentages are of the cells evaluated for that behavior.{' '}
            </Show>
            {s().missingCells
              ? `${s().missingCells} cell${s().missingCells === 1 ? '' : 's'} not evaluated for any behavior: non-finite neural value (listed in Run details).`
              : 'Every cell has a value for each tested behavior.'}
          </div>
        </section>
        <Show when={labelled()}>
          <section class="cb-plot cb-pe-bars">
            <div class="cb-plot__head">
              <h3>Share of evaluated cells</h3>
              <HowTo title="Response counts">
                <p>
                  Each bar is one behavior; segments are the share of the cells evaluated for it that are Higher
                  (orange), Lower (purple) or Not significant (gray). Cells not evaluated for a behavior are not in
                  the percentages. One cell can appear in several bars.
                </p>
                <LabelNote out={o()} />
              </HowTo>
            </div>
            <div class="cb-pe-bars__list">
              <For each={s().perBehavior.filter((p) => !p.reason)}>
                {(p) => {
                  const total = () => p.counts.excited + p.counts.inhibited + p.counts['not significant'];
                  return (
                    <div class="cb-auroc-bar">
                      <span>{p.label}</span>
                      <div
                        class="cb-auroc-bar__track"
                        role="img"
                        aria-label={`${p.label}: ${p.counts.excited} higher, ${p.counts.inhibited} lower, ${p.counts['not significant']} not significant`}
                      >
                        <i style={{ width: `${total() ? (100 * p.counts.excited) / total() : 0}%`, background: ORANGE }} />
                        <i style={{ width: `${total() ? (100 * p.counts.inhibited) / total() : 0}%`, background: PURPLE }} />
                        <i style={{ width: `${total() ? (100 * p.counts['not significant']) / total() : 0}%`, background: LIGHT }} />
                      </div>
                      <span class="cb-muted">
                        {pct(p.counts.excited, total())} ▲ · {pct(p.counts.inhibited, total())} ▼
                      </span>
                    </div>
                  );
                }}
              </For>
            </div>
            <div class="cb-muted cb-pe-small">
              <span style={{ color: ORANGE }}>■</span> Higher (excited) · <span style={{ color: PURPLE }}>■</span> Lower
              (inhibited) · <span style={{ color: LIGHT }}>■</span> Not significant
            </div>
          </section>
        </Show>
      </div>
      <section class="cb-plot cb-pe-lat">
        <div class="cb-plot__head">
          <h3>Latency of significant cells (descriptive)</h3>
          <HowTo title="Latency">
            <p>
              For each cell with a significant response, the first bin at or after the onset where its mean curve is
              outside the null band for {o().settings.latencyBins} bins in a row. Bars count cells per {binFrames(o()) / o().input.fs} s
              bin of latency, one color per behavior.
            </p>
            <p>
              Descriptive only: latency is not tested and not corrected for the number of bins or cells. Cells
              whose curve never leaves the band have no latency and are not counted.
            </p>
          </HowTo>
        </div>
        <div class="cb-plot__body">
          <Show
            when={labelled() && o().band && nLatency()}
            fallback={
              <div class="cb-muted cb-pe-small">
                {!labelled()
                  ? 'Latency is shown for significant cells; this run had no shuffle test.'
                  : !o().band
                    ? 'The null band and latency were off in this run.'
                    : 'No significant cell has a latency.'}
              </div>
            }
          >
            <Fit>{(w, h) => <LatencyHist out={o()} w={w} h={h} />}</Fit>
          </Show>
        </div>
        <div class="cb-pe-small cb-pe-legend">
          <For each={s().perBehavior.filter((p) => p.latencies.higher.length + p.latencies.lower.length)}>
            {(p) => (
              <span>
                <Dot label={p.label} /> {p.label}
              </span>
            )}
          </For>
        </div>
        <div class="cb-muted cb-pe-small">
          First time after onset that the mean curve stays outside its null band for {o().settings.latencyBins} bins. Not
          tested.
        </div>
        <div class="cb-pe-small">{DIRECTION_NOTE}</div>
      </section>
    </div>
  );
}
