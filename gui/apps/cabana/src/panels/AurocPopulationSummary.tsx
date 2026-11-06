// The auROC Population summary tab: responses by behavior, the auROC histogram and the response patterns.

import { createMemo, For, Show, type JSX } from 'solid-js';
import { aurocHistogram, heatHalfRange, isSingleBehavior } from '../lib/auroc-population.ts';
import { summarize } from '../lib/auroc-view.ts';
import { AurocHistogram } from './AurocPopulationPlots.tsx';
import { Fit, HowTo, pct, type Ctx } from './AurocResults.tsx';

export function BehaviorSummary(props: { ctx: Ctx }): JSX.Element {
  const c = () => props.ctx;
  const o = () => c().out;
  const s = createMemo(() => summarize(o()));
  const half = createMemo(() => heatHalfRange(o()));
  const single = () => isSingleBehavior(o());
  const bins = createMemo(() => aurocHistogram(o(), c().b, half()));
  // Cells by number of significant behaviors, grouped as 0, 1 and 2 or more
  const overlap = () => {
    const by = s().bySignificantCount;
    return [
      { k: '0', n: by[0] ?? 0 },
      { k: '1', n: by[1] ?? 0 },
      { k: '2 or more', n: by.slice(2).reduce((a, n) => a + n, 0) },
    ];
  };
  return (
    <div class="cb-ar-pop">
      <div class="cb-setgroup cb-ar-pop__bars">
        <div class="cb-ar-plot__head">
          <h4>Responses by behavior</h4>
          <HowTo title="Responses by behavior">
            <p>
              Each bar is one behavior and sums to 100% of the cells evaluated for it. Orange and
              purple segments are cells with a significant higher or lower response after
              correction; gray segments are not significant. Cells are counted once per behavior, so
              one cell can appear in several bars. Cells not evaluated for a behavior are left out
              of its percentages and listed beside the bar.
            </p>
            <p>
              Click a bar to select that behavior for the histogram, the cards and the other tabs.
            </p>
          </HowTo>
          <span class="cb-muted cb-ar-pop__n">{s().cells.toLocaleString()} cells</span>
        </div>
        <div class="cb-ar-pop__list">
          <For each={s().perBehavior}>
            {(b, i) => {
              const total = () =>
                b.counts.excited + b.counts.inhibited + b.counts['not significant'];
              return (
                <button
                  type="button"
                  class="cb-ar-pop__row"
                  classList={{ 'cb-ar-pop__row--on': i() === c().b }}
                  aria-pressed={i() === c().b}
                  onClick={() => c().setBehavior(i())}
                >
                  <span class="cb-ar-pop__name" title={b.label}>
                    {b.label}
                  </span>
                  <span
                    class="cb-auroc-bar__track"
                    role="img"
                    aria-label={`${b.label}: ${b.counts.excited} higher, ${b.counts.inhibited} lower, ${b.counts['not significant']} not significant of ${total()} evaluated`}
                  >
                    <For each={['excited', 'inhibited', 'not significant'] as const}>
                      {(r) => (
                        <i
                          style={{
                            width: `${total() ? (100 * b.counts[r]) / total() : 0}%`,
                            background: SEGMENT[r],
                          }}
                        />
                      )}
                    </For>
                  </span>
                  <span class="cb-muted cb-ar-pop__counts">
                    ▲ {b.counts.excited} ({pct(b.counts.excited, total())}) · ▼ {b.counts.inhibited}{' '}
                    ({pct(b.counts.inhibited, total())}) · {b.counts['not significant']} n.s.
                    {b.counts['not evaluated']
                      ? ` · ${b.counts['not evaluated']} not evaluated`
                      : ''}
                  </span>
                </button>
              );
            }}
          </For>
        </div>
        <div class="cb-ar-pop__key">
          <span>
            <i style={{ background: SEGMENT.excited }} /> Higher activity
          </span>
          <span>
            <i style={{ background: SEGMENT.inhibited }} /> Lower activity
          </span>
          <span>
            <i style={{ background: SEGMENT['not significant'] }} /> Not significant
          </span>
        </div>
      </div>
      <div class="cb-ar-pop__side">
        <div class="cb-setgroup cb-ar-pop__hist">
          <div class="cb-ar-plot__head">
            <h4>auROC across cells · {o().labels[c().b]}</h4>
            <HowTo title="auROC across cells">
              <p>
                Each bar counts evaluated cells with an auROC in that range for the selected
                behavior. Orange and purple are significant higher and lower cells after correction,
                gray is not significant. The dashed line is 0.5, no tendency. The x range matches
                the heatmap color scale. Cells not evaluated are left out.
              </p>
            </HowTo>
          </div>
          <Fit height={210}>
            {(w, h) => <AurocHistogram bins={bins()} half={half()} w={w} h={h} />}
          </Fit>
        </div>
        <Show when={!single()}>
          <div class="cb-setgroup">
            <div class="cb-ar-plot__head">
              <h4>Unique cells by number of significant behaviors</h4>
              <HowTo title="Unique cells by number of significant behaviors">
                <p>
                  Each evaluated cell is counted once, by how many behaviors it responds to
                  significantly. Cells with 0 respond to none of the analyzed behaviors; 2 or more
                  suggests a response to several behaviors.
                </p>
              </HowTo>
            </div>
            <For each={overlap()}>
              {({ k, n }) => (
                <div class="cb-auroc-bar">
                  <span>{k} significant</span>
                  <div class="cb-auroc-bar__track">
                    <i
                      style={{
                        width: `${s().evaluated ? (100 * n) / s().evaluated : 0}%`,
                        background: k === '0' ? '#c9c9c9' : '#1f6fb2',
                      }}
                    />
                  </div>
                  <span class="cb-muted">
                    {n} of {s().evaluated} cells · {pct(n, s().evaluated)}
                  </span>
                </div>
              )}
            </For>
          </div>
          <div class="cb-setgroup cb-ar-pop__patterns">
            <h4>Response patterns</h4>
            <Show
              when={s().patterns.length}
              fallback={<p class="cb-muted">No cell responds significantly to a behavior.</p>}
            >
              <div class="cb-ar-pop__scroll">
                <table class="cb-auroc-table">
                  <thead>
                    <tr>
                      <th>Pattern</th>
                      <th>Cells</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={s().patterns}>
                      {(p) => (
                        <tr>
                          <td>{p.pattern}</td>
                          <td>{p.cells}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
            <div class="cb-muted">▲ higher activity · ▼ lower activity</div>
          </div>
        </Show>
      </div>
    </div>
  );
}

const SEGMENT: Record<'excited' | 'inhibited' | 'not significant', string> = {
  excited: '#e8851a',
  inhibited: '#6a3db8',
  'not significant': '#c9c9c9',
};
