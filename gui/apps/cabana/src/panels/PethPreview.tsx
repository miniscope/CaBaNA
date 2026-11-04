// The Review-stage preview: mean curves over cells for each tested behavior, drawn from the loaded
// data with the current settings. No shuffle test, no labels, no null band.

import { createMemo, For, Show, type JSX } from 'solid-js';
import { pethSettings } from '../lib/peth-run.ts';
import { signalLabel, previewCurves } from '../lib/peth-setup.ts';
import { timeDomain } from '../lib/peth-view.ts';
import type { Align } from '../lib/peth.ts';
import { Fit, HowTo } from './AurocResults.tsx';
import { CurvePlot } from './PethPlots.tsx';
import { colorOf, Dot } from './PethShared.tsx';
import type { PethSetupState } from './PethSetupState.ts';

const axisLabel = (a: Align) => `Time from bout ${a} (s)`;

export function PethPreview(props: { s: PethSetupState }): JSX.Element {
  const s = () => props.s;
  const preview = createMemo(() => {
    const d = s().ok();
    const r = s().aligned();
    return d && r && !s().issue()
      ? previewCurves(
          d,
          { params: s().p(), unselected: [...pethSettings.unselected], align: pethSettings.align },
          r,
        )
      : undefined;
  });
  return (
    <section class="cb-plot cb-pe-preview">
      <div class="cb-plot__head">
        <h4>PETH preview</h4>
        <span class="cb-badge cb-badge--warn">Preview: no significance test</span>
        <HowTo title="PETH preview">
          <p>
            Mean of each behavior's included bouts, averaged over all cells, from the loaded data
            and the current settings. Shading is ± SEM across cells.{' '}
            {signalLabel(s().p().baselineSubtract)}.
          </p>
          <p>
            This preview has no shuffle test, null band or labels, so it cannot say which cells
            respond. It shows whether the window, baseline and response intervals and the included
            bouts look reasonable before the full analysis. PETH runs only in the browser, so there
            is no shorter run with fewer shuffles.
          </p>
        </HowTo>
      </div>
      <Show
        when={preview()}
        fallback={<div class="cb-muted">No preview until the settings can run: {s().issue()}</div>}
      >
        {(pv) => (
          <div class="cb-pe-preview__plots">
            <For each={s().aligns()}>
              {(a) => {
                const cols = () =>
                  pv().columns.filter((c) => c.align === a && c.bouts >= s().p().minEvents);
                return (
                  <div class="cb-pe-preview__one">
                    <Show when={s().aligns().length > 1}>
                      <div class="cb-pe-small">
                        <b>Aligned to bout {a}</b>
                      </div>
                    </Show>
                    <div class="cb-pe-preview__plot">
                      <Fit>
                        {(w, h) => (
                          <CurvePlot
                            w={w}
                            h={h}
                            label={`Mean curves over cells, aligned to bout ${a}`}
                            timeS={pv().axis.curves.timeS}
                            domain={timeDomain(pv().axis)}
                            series={cols().map((c) => ({
                              mean: c.mean,
                              sem: c.sem,
                              color: colorOf(c.label),
                            }))}
                            baseline={s().p().baselineS}
                            response={s().p().responseS}
                            yLabel={s().p().baselineSubtract ? 'Δ (a.u.)' : 'a.u.'}
                            xLabel={axisLabel(a)}
                          />
                        )}
                      </Fit>
                    </div>
                    <div class="cb-pe-small cb-pe-legend">
                      <For each={cols()}>
                        {(c) => (
                          <span>
                            <Dot label={c.label} /> {c.label} ({c.bouts} bouts)
                          </span>
                        )}
                      </For>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        )}
      </Show>
    </section>
  );
}
