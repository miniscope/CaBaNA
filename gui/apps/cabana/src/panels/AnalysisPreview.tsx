// The Preview window of one analysis. PETH shows its mean-curve preview beside the settings it was
// drawn with. The other analyses show their review content: the settings summary and the Quick
// preview / full analysis choice. The setup pages open this content on a "review" stage and move to
// "run" when a run starts, so the window follows that stage: starting a run closes it, and an
// Edit link in the summary opens Configure settings.

import { createEffect, on, type Component, type JSX } from 'solid-js';
import { Modal } from '../components/Modal.tsx';
import { Pill } from '../components/Pill.tsx';
import { ANALYSES } from '../lib/analyses.ts';
import { guided } from '../lib/guided.ts';
import type { AnalysisItem } from '../lib/readiness.ts';
import { openAnalysisWindow } from '../lib/analysis-window.ts';
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
  const g = guided(id, '');
  g.setStage('review');
  createEffect(
    on(
      g.stage,
      (stage) => {
        if (stage === 'configure') openAnalysisWindow(id, 'configure');
        if (stage === 'run') props.onClose();
        if (stage !== 'review') g.setStage('review');
      },
      { defer: true },
    ),
  );
  const View = VIEWS[id];
  return (
    <Modal
      label={`Preview, ${label}`}
      title={`Preview · ${label}`}
      head={id === 'peth' ? <Pill tone="flag">Preview: no significance test</Pill> : undefined}
      width={980}
      height={560}
      onClose={() => props.onClose()}
    >
      <div class="cb-prv">
        <View />
      </div>
    </Modal>
  );
}
