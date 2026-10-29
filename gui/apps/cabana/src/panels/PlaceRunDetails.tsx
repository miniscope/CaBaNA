import { createEffect, For, Show, type JSX } from 'solid-js';
import { HowToRead } from './parts.tsx';
import { downloadText, placeMetadata } from '../lib/place-export.ts';
import { engineText } from '../lib/engine.ts';
import type { PlaceOutcome } from '../lib/place-run.ts';
import type { SigmaChoice } from '../lib/placecells.ts';
import { RunDetailsBody } from './results/RunDetails.tsx';

const num = (v: number, d = 2) => (Number.isNaN(v) ? '–' : v.toFixed(d));
const bins = (n: number) => `${n} bin${n === 1 ? '' : 's'}`;

/** The held-out score of each smoothing width, with its standard error. The selected and the best widths are marked. */
function SigmaPlot(props: { c: SigmaChoice }): JSX.Element {
  const W = 300;
  const H = 150;
  const [L, R, T, B] = [60, 10, 10, 30];
  const c = () => props.c;
  const lo = () => Math.min(...c().scores.map((s, i) => s - c().se[i]));
  const hi = () => Math.max(...c().scores.map((s, i) => s + c().se[i]));
  const xMax = () => Math.max(...c().candidates);
  const x = (v: number) => L + (v / (xMax() || 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo()) / (hi() - lo() || 1)) * (H - T - B);
  const ticks = () => [lo(), (lo() + hi()) / 2, hi()];
  // The framework records one standard error (in its note), not one per width, so its runs show none.
  const hasSe = () => c().se.some((v) => v > 0);
  return (
    <svg
      class="cb-sigma"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Held-out score by smoothing width; ${bins(c().sigma)} selected, best at ${bins(c().best)}`}
    >
      <For each={ticks()}>
        {(t) => (
          <>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#ddd" />
            <text x={L - 4} y={y(t) + 3} text-anchor="end" font-size="9" fill="#666">
              {Math.round(t).toLocaleString()}
            </text>
          </>
        )}
      </For>
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="#999" />
      <polyline
        fill="none"
        stroke="#2171b5"
        stroke-width="1.5"
        points={c()
          .candidates.map((s, i) => `${x(s)},${y(c().scores[i])}`)
          .join(' ')}
      />
      <For each={c().candidates}>
        {(s, i) => (
          <>
            <Show when={hasSe()}>
              <line
                x1={x(s)}
                x2={x(s)}
                y1={y(c().scores[i()] - c().se[i()])}
                y2={y(c().scores[i()] + c().se[i()])}
                stroke="#6b8fb5"
              />
            </Show>
            <circle
              cx={x(s)}
              cy={y(c().scores[i()])}
              r={s === c().sigma ? 5.5 : 3.5}
              fill={s === c().sigma ? '#2171b5' : s === c().best ? '#222' : '#fff'}
              stroke={s === c().sigma ? '#fff' : '#2171b5'}
              stroke-width={s === c().sigma ? 1.5 : 1}
            >
              <title>{`${bins(s)}: score ${num(c().scores[i()], 1)}${hasSe() ? ` ± ${num(c().se[i()], 1)}` : ''}`}</title>
            </circle>
            <text x={x(s)} y={H - B + 12} text-anchor="middle" font-size="9" fill="#666">
              {s}
            </text>
          </>
        )}
      </For>
      <text x={(L + W - R) / 2} y={H - 4} text-anchor="middle" font-size="9" fill="#666">
        Smoothing (bins)
      </text>
      <text
        transform={`translate(9,${(T + H - B) / 2}) rotate(-90)`}
        text-anchor="middle"
        font-size="9"
        fill="#666"
      >
        Held-out score
      </text>
    </svg>
  );
}

/** What a place-cell run used and chose. Read only: changes go through Edit settings and a new run. */
export function PlaceRunDetails(props: { out: PlaceOutcome; onClose: () => void }): JSX.Element {
  let close: HTMLButtonElement | undefined;
  createEffect(() => close?.focus());
  const o = () => props.out;
  const s = () => o().settings;
  const g = () => o().data.grid;
  const KV = (p: { k: string; v: JSX.Element }) => (
    <div class="cb-kv">
      <span>{p.k}</span>
      <span>{p.v}</span>
    </div>
  );
  return (
    <aside
      class="cb-drawer"
      role="dialog"
      aria-label="Run details"
      onKeyDown={(e) => e.key === 'Escape' && props.onClose()}
    >
      <div class="cb-drawer__head">
        <h3>Run details</h3>
        <button
          ref={close}
          class="cb-link"
          aria-label="Close run details"
          onClick={() => props.onClose()}
        >
          ✕
        </button>
      </div>
      <p class="cb-muted">
        Settings and automatic parameter choices. Use Edit settings to change them.
      </p>

      <section>
        <h4>Engine</h4>
        <KV k="Engine" v={engineText(o().engine)} />
        <Show when={o().record}>
          {(r) => (
            <details class="cb-notebox">
              <summary>Framework run record</summary>
              <RunDetailsBody record={r()} />
            </details>
          )}
        </Show>
      </section>

      <section>
        <h4>Run configuration</h4>
        <KV k="Cells analyzed" v={o().data.cellIds.length} />
        <KV
          k="Frames used"
          v={`${o().data.used.toLocaleString()} / ${o().data.input.frames.toLocaleString()} (${Math.round((100 * o().data.used) / o().data.input.frames)}%)`}
        />
        <KV k="Minimum speed" v={`${o().data.minSpeed} cm/s`} />
        <KV k="Bin size" v={`${num(g().bin, 1)} cm (${g().nx} × ${g().ny} bins)`} />
        <KV k="Minimum time per bin, spatial tuning" v={`${s().minOccS} s`} />
        <KV k="Minimum time per bin, field boundaries" v={`${s().minOccFieldsS} s`} />
        <KV k="Significance" v={`p < ${s().alpha}`} />
        <KV
          k="Shuffles"
          v={`${o().nShuffles.toLocaleString()} (${o().distinctShifts.toLocaleString()} distinct)`}
        />
        <KV k="Smallest possible p" v={num(1 / (o().distinctShifts + 1), 4)} />
        <KV k="Random seed" v={s().seed} />
        <KV k="Fraction of peak for fields" v={s().fieldThreshold} />
        <KV k="Smallest field region" v={bins(s().minFieldBins)} />
        <KV k="Run time" v={`${num(o().seconds, 1)} s`} />
      </section>

      <section>
        <h4>
          Smoothing{' '}
          <span class="cb-pill">
            {o().sigmaChoice ? 'Selected' : 'Set manually'}: {bins(o().sigma)} (
            {num(o().sigma * g().bin, 1)} cm)
          </span>
        </h4>
        <Show
          when={o().sigmaChoice}
          fallback={
            <p class="cb-muted">The width was set in the settings, not chosen from the data.</p>
          }
        >
          {(c) => (
            <>
              <p class="cb-muted">
                Maps built on part of the session predict the rest. The least smoothing within one
                standard error of the best score is kept.
              </p>
              <SigmaPlot c={c()} />
              <HowToRead>
                <p>
                  Each point is a smoothing width and its held-out score: maps built on part of the session are used to predict the
                  rest, and higher is better. {c().se.some((v) => v > 0) ? 'Bars show ± 1 standard error. ' : ''}The width kept is the smallest one within one standard
                  error of the best, so no p-value is used to choose it.
                </p>
              </HowToRead>
              <div class="cb-legend">
                <span class="cb-legend__item">
                  <svg width="12" height="12">
                    <circle cx="6" cy="6" r="5" fill="#2171b5" />
                  </svg>{' '}
                  Selected: {bins(c().sigma)}
                </span>
                <span class="cb-legend__item">
                  <svg width="12" height="12">
                    <circle cx="6" cy="6" r="4" fill="#222" />
                  </svg>{' '}
                  Best score: {bins(c().best)}
                </span>
                <Show when={c().se.some((v) => v > 0)}>
                  <span class="cb-legend__item">Bars: ± 1 standard error</span>
                </Show>
              </div>
              <details class="cb-notebox">
                <summary>View score table</summary>
                <table class="cb-stats">
                  <thead>
                    <tr>
                      <th>Smoothing (bins)</th>
                      <th>Held-out score</th>
                      <Show when={c().se.some((v) => v > 0)}>
                        <th>Standard error</th>
                      </Show>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={c().candidates}>
                      {(v, i) => (
                        <tr classList={{ 'cb-row-pick--on': v === c().sigma }}>
                          <td>
                            {v}
                            {v === c().sigma ? ' (selected)' : v === c().best ? ' (best)' : ''}
                          </td>
                          <td>{num(c().scores[i()], 1)}</td>
                          <Show when={c().se.some((v) => v > 0)}>
                            <td>{num(c().se[i()], 1)}</td>
                          </Show>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </details>
            </>
          )}
        </Show>
      </section>

      <section>
        <h4>
          Minimum circular shift{' '}
          <span class="cb-pill">
            {o().timescale ? 'Selected' : 'Set manually'}: {num(o().minShiftS, 1)} s
          </span>
        </h4>
        <Show
          when={o().timescale}
          fallback={
            <p class="cb-muted">The time was set in the settings, not chosen from the data.</p>
          }
        >
          {(t) => (
            <details class="cb-notebox">
              <summary>Calculation details</summary>
              <div class="cb-muted">
                <p>
                  Neural data decorrelates in {num(t().tauNeuralS)} s (median over cells) and
                  position in {num(t().tauPositionS)} s. {t().note}.
                </p>
              </div>
            </details>
          )}
        </Show>
      </section>

      <button
        class="btn-secondary cb-drawer__export"
        onClick={() =>
          downloadText(
            'place_cells_run.json',
            JSON.stringify(placeMetadata(o()), null, 2),
            'application/json',
          )
        }
      >
        Export run metadata
      </button>
    </aside>
  );
}
