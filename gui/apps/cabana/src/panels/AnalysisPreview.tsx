// The Preview window of one analysis: the result of a preview run on the left, and on the right the
// current settings, the number of shuffles and Run preview. A preview is a Preview run saved with
// the other runs; running one keeps the window open and shows its result. PETH draws its preview in
// the browser and saves nothing. The settings link opens Configure settings.

import { Show, type Component, type JSX } from 'solid-js';
import { Modal } from '../components/Modal.tsx';
import { Pill, RunTypePill } from '../components/Pill.tsx';
import { ANALYSES } from '../lib/analyses.ts';
import { forgetPreview, previewRecord } from '../lib/preview-window.ts';
import { runType } from '../lib/preview.ts';
import type { AnalysisItem } from '../lib/readiness.ts';
import { AurocSetup } from './AurocPanel.tsx';
import { DecodingSetup } from './decoding/GuidedPage.tsx';
import { PethPreviewView } from './PethPanel.tsx';
import { PlaceSetup } from './PlaceCellsPanel.tsx';
import { PopulationSetup } from './PopulationPanel.tsx';

const VIEWS: Record<AnalysisItem, Component> = {
  place: () => <PlaceSetup review />,
  auroc: () => <AurocSetup review />,
  peth: PethPreviewView,
  decoding: () => <DecodingSetup review />,
  population: () => <PopulationSetup review />,
};

export function AnalysisPreview(props: { id: AnalysisItem; onClose: () => void }): JSX.Element {
  // One window per analysis: the id never changes while it is open.
  // eslint-disable-next-line solid/reactivity
  const id = props.id;
  const label = ANALYSES.find((a) => a.id === id)!.label;
  // Opens with no preview shown; the result appears after Run preview.
  forgetPreview(id);
  const View = VIEWS[id];
  return (
    <Modal
      label={`Preview, ${label}`}
      title={`Preview · ${label}`}
      head={
        id === 'peth' ? (
          <Pill tone="flag">Preview: no significance test</Pill>
        ) : (
          <Show when={previewRecord(id)}>{(rec) => <RunTypePill type={runType(rec())} />}</Show>
        )
      }
      width={980}
      height={id === 'peth' ? 560 : 640}
      onClose={() => props.onClose()}
    >
      <div class="cb-prv">
        <View />
      </div>
    </Modal>
  );
}
