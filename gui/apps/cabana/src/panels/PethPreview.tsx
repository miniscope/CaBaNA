// The Preview window's plot: mean curves over cells for each tested behavior, drawn from the loaded
// data with the current settings. No shuffle test and no labels. After Run preview, a grey band
// shows the spread of the shifted-onset means (`previewBand`). Nothing here is saved.

import { createMemo, For, Show, type JSX } from 'solid-js';
import { pethSettings } from '../lib/peth-run.ts';
import { previewCurves } from '../lib/peth-setup.ts';
import { timeDomain } from '../lib/peth-view.ts';
import type { Align } from '../lib/peth.ts';
import { Fit } from './AurocResults.tsx';
import { CurvePlot } from './PethPlots.tsx';
import { colorOf, Dot } from './PethShared.tsx';
import type { PethSetupState } from './PethSetupState.ts';

type Column = ReturnType<typeof previewCurves>['columns'][number];
const axisLabel = (a: Align) => `Time from bout ${a} (s)`;

export function PethPreview(props: {
  s: PethSetupState;
  /** The band of each column from `previewBand` and how many shifted-onset means drew it. */
  band?: { bands: { lo: ArrayLike<number>; hi: ArrayLike<number> }[]; shifts: number };
}): JSX.Element {
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
      <Show
        when={preview()}
        fallback={<div class="cb-muted">No preview until the settings can run: {s().issue()}</div>}
      >
        {(pv) => (
          <div class="cb-pe-preview__plots">
            <For each={s().aligns()}>
              {(a) => {
                const ok = (c: Column) =>
                  c.align === a && c.bouts >= s().p().minEvents;
                const cols = () => pv().columns.filter(ok);
                const keep = (k: number) => ok(pv().columns[k]);
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
                            bands={props.band?.bands.filter((_, k) => keep(k))}
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
                      <Show when={props.band}>
                        {(b) => (
                          <span>
                            <i class="cb-pe-legend__band" aria-hidden="true" />{' '}
                            {b().shifts.toLocaleString()} shifted-onset means
                          </span>
                        )}
                      </Show>
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
