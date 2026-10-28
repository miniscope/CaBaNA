// PETH results, cell inspector: one cell and behavior in detail.

import { createMemo, For, Show, type JSX } from 'solid-js';
import { shiftedValues } from '../lib/peth-run.ts';
import {
  curveOf,
  hasTest,
  labelAt,
  latencyOf,
  latencyText,
  nBehaviors,
  pAdjOf,
  pRawOf,
  rawWindows,
  timeDomain,
  valueOf,
  whyNotEvaluated,
  wilcoxonOf,
  timeAxisLabel,
} from '../lib/peth-view.ts';
import { MIN_NONZERO_PREPOST } from '../lib/peth.ts';
import { Fit, HowTo } from './AurocResults.tsx';
import { binText, MeanHelp, RasterHelp, rawLimits } from './PethPopulation.tsx';
import { CurvePlot, fmtP, GRAY, Histogram, num, ORANGE, PURPLE, Raster } from './PethPlots.tsx';
import { colorOf, DIRECTION_NOTE, Dot, Label, LabelNote, LatencyNote, alignWord, type Ctx } from './PethShared.tsx';

const labelColor = (r: string | undefined) => (r === 'excited' ? ORANGE : r === 'inhibited' ? PURPLE : GRAY);

/** This cell's mean response to each behavior, small and on one y scale. */
function BehaviorStrip(props: { ctx: Ctx }): JSX.Element {
  const o = () => props.ctx.out;
  const range = createMemo((): [number, number] => {
    const v = [0];
    o().labels.forEach((_, b) => curveOf(o(), props.ctx.c, b).mean.forEach((x) => Number.isFinite(x) && v.push(x)));
    const [lo, hi] = [Math.min(...v), Math.max(...v)];
    const pad = (hi - lo) * 0.08 || 0.1;
    return [lo - pad, hi + pad];
  });
  return (
    <div class="cb-pe-strip">
      <For each={o().labels}>
        {(label, bi) => {
          const b = bi();
          const r = () => labelAt(o(), props.ctx.c, b);
          const bad = () => !!whyNotEvaluated(o(), props.ctx.c, b);
          return (
            <div class="cb-pe-strip__row" classList={{ 'cb-pe-strip__row--on': b === props.ctx.b }}>
              <div class="cb-pe-strip__name">
                <span>
                  <Dot label={label} muted={bad()} /> {label}
                </span>
                <span class="cb-pe-small" style={{ color: labelColor(r()) }}>
                  {bad() ? 'Not evaluated' : r() === 'excited' ? '▲ Higher' : r() === 'inhibited' ? '▼ Lower' : hasTest(o()) ? 'Not significant' : ''}
                </span>
              </div>
              <div class="cb-pe-strip__plot">
                <Show when={!bad()}>
                  <Fit>
                    {(w, h) => (
                      <CurvePlot
                        w={w}
                        h={h}
                        axes={false}
                        label={`Mean response of this cell to ${label}`}
                        timeS={o().curves.timeS}
                        domain={timeDomain(o())}
                        series={[{ mean: curveOf(o(), props.ctx.c, b).mean, color: labelColor(r()) }]}
                        yRange={range()}
                      />
                    )}
                  </Fit>
                </Show>
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
}

export function PethInspector(props: { ctx: Ctx }): JSX.Element {
  const c = () => props.ctx;
  const o = () => c().out;
  const cell = () => c().c;
  const pos = () => c().order.indexOf(cell());
  const step = (d: 1 | -1) => {
    const next = c().order[Math.min(c().order.length - 1, Math.max(0, pos() + d))];
    if (next !== undefined) c().setC(next);
  };
  const r = () => labelAt(o(), cell(), c().b);
  const raw = createMemo(() => rawWindows(o(), cell(), c().b));
  const k = () => curveOf(o(), cell(), c().b);
  const value = () => valueOf(o(), cell(), c().b);
  const why = () => whyNotEvaluated(o(), cell(), c().b);
  const draws = createMemo(() => {
    if (!hasTest(o()) || !Number.isFinite(value())) return undefined;
    const all = shiftedValues(o(), cell());
    const nb = nBehaviors(o());
    return Float64Array.from({ length: o().shifts.length }, (_, i) => all[i * nb + c().b]);
  });
  const lat = () => latencyOf(o(), cell(), c().b);
  const KV = (p: { k: string; v: JSX.Element }) => (
    <div class="cb-kv">
      <span>{p.k}</span>
      <span>{p.v}</span>
    </div>
  );
  return (
    <div class="cb-pe-insp">
      <div class="cb-pe-insp__bar">
        <button class="btn-secondary btn-small" onClick={c().backToPopulation}>
          ← Back to population
        </button>
        <strong>Cell {o().cellIds[cell()] + 1}</strong>
        <button class="btn-secondary btn-small" aria-label="Previous cell" disabled={pos() <= 0} onClick={() => step(-1)}>
          ‹
        </button>
        <button
          class="btn-secondary btn-small"
          aria-label="Next cell"
          disabled={pos() >= c().order.length - 1}
          onClick={() => step(1)}
        >
          ›
        </button>
        <label class="cb-sortpick">
          Behavior
          <select value={c().b} onChange={(e) => c().setB(+e.currentTarget.value)}>
            <For each={o().labels}>
              {(l, b) => (
                <option value={b()} disabled={o().reports[b()].onsets.length < o().params.minEvents}>
                  {l}
                </option>
              )}
            </For>
          </select>
        </label>
        <span class="cb-pe-spacer" />
        <Label out={o()} r={r()} />
      </div>
      <div class="cb-pe-insp__grid">
        <section class="cb-plot">
          <div class="cb-plot__head">
            <h3>Single onsets, raw windows ({raw().rows})</h3>
            <RasterHelp out={o()} />
          </div>
          <div class="cb-plot__body">
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
                  label={`Raw neural windows of cell ${o().cellIds[cell()] + 1}, one row per onset`}
                />
              )}
            </Fit>
          </div>
        </section>
        <div class="cb-pe-col">
          <section class="cb-plot cb-pe-mean">
            <div class="cb-plot__head">
              <h3>Mean response</h3>
              <MeanHelp out={o()} />
            </div>
            <div class="cb-muted cb-pe-small">
              {o().params.baselineSubtract ? 'Baseline-subtracted' : 'Not baseline-subtracted'}, {binText(o())} bins, ± SEM
              across onsets{o().band ? ' · gray: null band' : ''}
            </div>
            <div class="cb-plot__body">
              <Fit>
                {(w, h) => (
                  <CurvePlot
                    w={w}
                    h={h}
                    label={`Mean response of cell ${o().cellIds[cell()] + 1}`}
                    timeS={o().curves.timeS}
                    domain={timeDomain(o())}
                    series={[{ mean: k().mean, sem: k().sem, color: colorOf(o().labels[c().b]) }]}
                    band={k().lo && k().hi ? { lo: k().lo!, hi: k().hi! } : undefined}
                    latencyS={lat()}
                    baseline={o().params.baselineS}
                    response={o().params.responseS}
                    yLabel={o().params.baselineSubtract ? 'Δ (a.u.)' : 'a.u.'}
                    xLabel={timeAxisLabel()}
                  />
                )}
              </Fit>
            </div>
          </section>
          <section class="cb-plot cb-pe-hist">
            <div class="cb-plot__head">
              <h3>Shuffle distribution</h3>
              <HowTo title="Shuffle distribution">
                <p>
                  Response minus baseline (a.u.) after each of {o().shifts.length.toLocaleString()} circular shifts of this
                  cell's trace, with the aligned frames fixed. The colored line is the observed value; the dashed line
                  is 0.
                </p>
                <p>
                  The p-value counts shifts at least as extreme as the observed value, two-sided
                  {o().settings.correction === 'max_stat'
                    ? ', then is adjusted with max-stat across the selected behaviors of this cell'
                    : ' (uncorrected)'}
                  .
                </p>
              </HowTo>
            </div>
            <div class="cb-plot__body">
              <Show
                when={draws()}
                fallback={
                  <div class="cb-muted cb-pe-small">
                    {hasTest(o()) ? `No shuffle distribution: ${why() ?? 'no value'}.` : 'This run had no shuffle test.'}
                  </div>
                }
              >
                {(d) => (
                  <Fit>
                    {(w, h) => (
                      <Histogram
                        w={w}
                        h={h}
                        draws={d()}
                        observed={value()}
                        color={labelColor(r())}
                        xLabel="Response − baseline after circular shift (a.u.)"
                        label={`Observed ${num(value())} against ${d().length} shifted values`}
                      />
                    )}
                  </Fit>
                )}
              </Show>
            </div>
          </section>
        </div>
        <div class="cb-pe-col">
          <section class="cb-plot cb-pe-stats">
            <KV k="Response − baseline" v={`${num(value())} a.u.`} />
            <KV
              k={o().settings.correction === 'max_stat' ? 'Adjusted p (max-stat)' : 'Uncorrected p'}
              v={hasTest(o()) ? fmtP(pAdjOf(o(), cell(), c().b)) : 'not computed'}
            />
            <Show when={o().settings.correction === 'max_stat'}>
              <KV k="Raw p" v={hasTest(o()) ? fmtP(pRawOf(o(), cell(), c().b)) : 'not computed'} />
            </Show>
            <KV k="Estimated response latency" v={latencyText(o(), cell(), c().b) ?? 'not computed'} />
            <Show when={o().band}>
              <div class="cb-muted cb-pe-small">
                Time from {alignWord(o())} to the first of {o().settings.latencyBins} consecutive time bins where the mean
                response is outside the shuffled-data band on the same side. Descriptive: a latency does not mean the
                response is significant.
              </div>
              <LatencyNote out={o()} />
            </Show>
            <KV k="Onsets" v={o().reports[c().b].onsets.length} />
            <KV
              k="Wilcoxon p (descriptive)"
              v={
                !o().settings.wilcoxon
                  ? 'off'
                  : Number.isFinite(wilcoxonOf(o(), cell(), c().b))
                    ? fmtP(wilcoxonOf(o(), cell(), c().b))
                    : `not computed (fewer than ${MIN_NONZERO_PREPOST} non-zero differences)`
              }
            />
            <div class="cb-muted cb-pe-small">{DIRECTION_NOTE}</div>
          </section>
          <section class="cb-plot cb-pe-stripcard">
            <div class="cb-plot__head">
              <h3>All behaviors</h3>
              <HowTo title="All behaviors">
                <p>
                  This cell's mean response ({o().params.baselineSubtract ? 'baseline-subtracted, ' : ''}a.u.) to each behavior, drawn on one
                  shared y scale from {timeDomain(o())[0].toFixed(1)} to {timeDomain(o())[1].toFixed(1)} s around
                  {alignWord(o())} (dashed line). The text under the name is the response label for that behavior. The
                  selected behavior is highlighted.
                </p>
                <LabelNote out={o()} />
              </HowTo>
            </div>
            <BehaviorStrip ctx={c()} />
          </section>
        </div>
      </div>
    </div>
  );
}
