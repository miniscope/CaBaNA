// Review stage preview: the selected states in time and the time each one holds, read from the
// loaded annotations. No shuffling and no analysis is done here.

import { createMemo, For, Show, type JSX } from 'solid-js';
import { populationSettings as s } from '../../lib/population-settings.ts';
import { annotationResults, sessionDuration } from '../../lib/store.ts';
import { labelRows, neuralSummary, selectedLabels } from './data.ts';
import { binsOf } from './logic.ts';
import { stateTimes, timelineBars } from './setup-logic.ts';

const SLOT = { behaviors: 'behavior_annotations', zones: 'zone_annotations' } as const;

export function DataPreview(): JSX.Element {
  const labels = createMemo(() => selectedLabels());
  const bars = createMemo(() => {
    const target = s.target;
    if (target === 'position') return {};
    const ann = annotationResults().find((r) => r.id === SLOT[target]);
    const dur = sessionDuration();
    return ann && !ann.error && dur ? timelineBars(ann.epochs, labels(), dur) : {};
  });
  const times = createMemo(() => {
    const n = neuralSummary();
    const total = n?.fs ? binsOf(n.frames, n.fs, s.binS) : 0;
    return stateTimes(
      labelRows().filter((r) => labels().includes(r.name)),
      s.binS,
      total,
    );
  });
  return (
    <section class="cb-pn-preview" aria-label="Data preview">
      <h4 class="cb-pn-h4">
        Data preview <span class="cb-muted">from the loaded annotations; nothing is shuffled</span>
      </h4>
      <Show
        when={s.target !== 'position'}
        fallback={
          <p class="cb-muted">
            Position bins are states of the arena grid. Occupancy per bin is shown in Experimental
            setup; there is no timeline of states to preview here.
          </p>
        }
      >
        <Show
          when={labels().length}
          fallback={<p class="cb-muted">No state is selected or usable.</p>}
        >
          <div class="cb-pn-tl" role="img" aria-label="Selected states over the session">
            <For each={times()}>
              {(t) => (
                <div class="cb-pn-tl__row">
                  <span class="cb-pn-tl__name" title={t.name}>
                    {t.name}
                  </span>
                  <span class="cb-pn-tl__track">
                    <For each={bars()[t.name] ?? []}>
                      {(b) => (
                        <i
                          style={{
                            left: `${b.left * 100}%`,
                            width: `max(1px, ${b.width * 100}%)`,
                          }}
                        />
                      )}
                    </For>
                  </span>
                  <span class="cb-pn-tl__time">
                    {t.seconds.toFixed(0)} s · {(t.share * 100).toFixed(0)}%
                  </span>
                </div>
              )}
            </For>
            <div class="cb-pn-tl__row cb-muted">
              <span />
              <span class="cb-pn-tl__axis">
                <span>0</span>
                <span>Time in session (s)</span>
                <span>{sessionDuration() ? sessionDuration()!.toFixed(0) : ''}</span>
              </span>
              <span>time in whole bins</span>
            </div>
          </div>
        </Show>
      </Show>
    </section>
  );
}
