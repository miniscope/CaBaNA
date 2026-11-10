// A file's QC section on the Data setup page: the QC test that belongs to that file, drawn with
// the same parts as the old Data QC page (summary and cards, plot tabs, checks with the review,
// and the test's own tools). The calculations are unchanged; only where they are shown moved.

import { createMemo, Show, type JSX } from 'solid-js';
import type { SlotId } from '../../lib/slots.ts';
import { rawTrace } from '../../lib/store.ts';
import { behaviorCategories, behaviorSettings } from '../BehaviorQc.tsx';
import { neuralCategories, neuralNote, neuralSettings } from '../NeuralQc.tsx';
import type { Category } from '../QcPanel.tsx';
import { RailBox } from '../QcParts.tsx';
import { CheckList, PlotTabs, plotTabOf, QcSummary } from '../QcShell.tsx';

/** The QC test of each file, by the test's id; annotation tests use the file's slot id. */
const TEST: Partial<Record<SlotId | 'sync', string>> = {
  sync: 'timing',
  position: 'position',
  neural_raw: 'cells',
  neural_denoised: 'cells',
  neural_deconvolved: 'decon',
  footprints: 'footprints',
  zone_annotations: 'zone_annotations',
  behavior_annotations: 'behavior_annotations',
};
const NEURAL = new Set(['cells', 'decon', 'footprints']);

export function FileQc(props: { id: SlotId | 'sync' }): JSX.Element {
  const testId = () => TEST[props.id];
  const neural = () => NEURAL.has(testId() ?? '');
  const cat = createMemo((): Category | undefined =>
    (neural() ? neuralCategories() : behaviorCategories()).find((c) => c.id === testId()),
  );
  // Cell checks are computed from one trace file: the raw traces when loaded, else the denoised.
  const otherSource = () => testId() === 'cells' && props.id === 'neural_denoised' && !!rawTrace();
  return (
    <Show
      when={cat()}
      fallback={<p class="cb-muted">No checks for this file yet. They run once it is loaded.</p>}
    >
      {(c) => (
        <div class="cb-ds-qc">
          <Show when={otherSource()}>
            <p class="cb-muted">
              Cell checks use the raw traces, so they are the same here and under Raw traces.
            </p>
          </Show>
          <QcSummary
            list={[c()]}
            cards={c().metrics()}
            settings={neural() ? neuralSettings() : behaviorSettings()}
            note={neural() ? neuralNote() : undefined}
          />
          <div class="cb-qc__body cb-qc__body--tabbed cb-ds-qc__body">
            <PlotTabs cat={c()}>{c().plot(plotTabOf(c()))}</PlotTabs>
            <aside class="cb-qc-rail cb-qrail">
              <CheckList cat={c()} />
              {c().flaggedList?.()}
              {c().actions?.()}
              <RailBox title="Correction">{c().correction()}</RailBox>
            </aside>
          </div>
        </div>
      )}
    </Show>
  );
}
