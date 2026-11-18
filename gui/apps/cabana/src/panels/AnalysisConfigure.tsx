// The Configure settings window of one analysis: its setting groups and their fields, opened from
// the analysis card. The fields edit the settings directly, so the window keeps a snapshot from
// when it opened: Discard changes (and closing with changes) puts it back, Save settings keeps
// what is there. Nothing here changes what an analysis computes.

import { createSignal, type Component, type JSX } from 'solid-js';
import { ActionsMenu } from '../components/ActionsMenu.tsx';
import type { ConfigureControl } from '../components/ConfigureBody.tsx';
import { HowItWorks } from '../components/GuidedReview.tsx';
import { Modal } from '../components/Modal.tsx';
import { Requirements } from '../components/Requirements.tsx';
import { ANALYSES } from '../lib/analyses.ts';
import {
  resetSettings,
  restoreSettings,
  settingsChanged,
  snapshotSettings,
} from '../lib/analysis-draft.ts';
import { prep } from '../lib/preprocess.ts';
import { statusOfItem } from '../lib/readiness-snapshot.ts';
import type { AnalysisItem } from '../lib/readiness.ts';
import { inputSignalText } from '../lib/peth-setup.ts';
import { AurocSetup } from './AurocPanel.tsx';
import { DecodingSetup, Method as DecodingMethod } from './decoding/GuidedPage.tsx';
import { PethSetup } from './PethPanel.tsx';
import { PethMethodText } from './PethSetupHead.tsx';
import { PlaceMethodText } from './PlaceMethodText.tsx';
import { HowPopulationWorks } from './population/SetupSummary.tsx';
import { AurocMethodText } from './AurocSetupFields.tsx';
import { PlaceSetup } from './PlaceCellsPanel.tsx';
import { PopulationSetup } from './PopulationPanel.tsx';
import { neuralSummary } from './population/data.ts';

const SETUPS: Record<AnalysisItem, Component<{ configure: ConfigureControl }>> = {
  place: PlaceSetup,
  auroc: AurocSetup,
  peth: PethSetup,
  decoding: DecodingSetup,
  population: PopulationSetup,
};

const METHOD: Record<AnalysisItem, Component> = {
  place: PlaceMethodText,
  auroc: AurocMethodText,
  peth: PethMethodText,
  decoding: DecodingMethod,
  population: HowPopulationWorks,
};

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** "180 cells · deconvolved events, not smoothed": what the settings apply to. */
function dataLine(id: AnalysisItem): string {
  const n = neuralSummary();
  const cells = n ? `${n.kept} cells · ` : '';
  // Only PETH states its smoothing; the other analyses say the unit alone.
  const signal =
    id === 'peth'
      ? lowerFirst(inputSignalText(prep.eventSigmaS)).replace(/, a\.u\.$/, '')
      : 'deconvolved events (a.u.)';
  return cells + signal;
}

export function AnalysisConfigure(props: {
  id: AnalysisItem;
  /** Settings text to go back to on Discard, when they were changed before the window opened. */
  before?: string;
  onClose: () => void;
}): JSX.Element {
  // One window per analysis: the id never changes while it is open.
  // eslint-disable-next-line solid/reactivity
  const id = props.id;
  const label = ANALYSES.find((a) => a.id === id)!.label;
  // eslint-disable-next-line solid/reactivity
  const before = props.before ?? snapshotSettings(id);
  const [reset, setReset] = createSignal(false);
  const changed = () => reset() || settingsChanged(id, before);
  let kept = false;

  const save = () => {
    if (reset()) resetSettings(id);
    kept = true;
    props.onClose();
  };
  // Closing any other way, including Discard changes, puts the earlier settings back.
  const leave = () => {
    if (!kept) restoreSettings(id, before);
    props.onClose();
  };
  const needsAttention = () =>
    ['needs_input', 'framework_update', 'outdated', 'failed'].includes(statusOfItem(id).kind);
  const Setup = SETUPS[id];
  const Method = METHOD[id];

  return (
    <Modal
      label={`Configure settings, ${label}`}
      title={`Configure settings · ${label}`}
      head={
        <>
          <span class="cb-muted cb-cfg__data">{dataLine(id)}</span>
          <HowItWorks title={`How the ${label} analysis works`}>
            <div class="cb-muted">
              <Method />
            </div>
          </HowItWorks>
        </>
      }
      bar={needsAttention() ? <Requirements analysis={id} /> : undefined}
      width={980}
      height={560}
      onClose={leave}
      confirmClose={() =>
        changed()
          ? 'The settings edited in this window go back to what they were when it opened.'
          : undefined
      }
      actions={
        <ActionsMenu
          items={[
            { kind: 'action', label: 'Save settings', onSelect: save },
            { kind: 'action', label: 'Discard changes', onSelect: leave },
          ]}
        />
      }
    >
      <Setup configure={{ reset, setReset }} />
    </Modal>
  );
}
