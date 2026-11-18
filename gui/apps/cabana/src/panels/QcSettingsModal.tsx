// The "QC settings…" window of a QC pop-up: the limits and thresholds of its tests. Changing one
// re-runs the checks at once, as the old QC settings button did.

import type { JSX } from 'solid-js';
import { Modal } from '../components/Modal.tsx';
import { annotationSettings, positionSettings } from './BehaviorQcSettings.tsx';
import { cellSettings, footprintSettings } from './NeuralQc.tsx';
import { QcSettingsBody, type SettingsGroup } from './QcParts.tsx';

export type SettingsId = 'neural' | 'footprints' | 'position' | 'behavior';

const GROUPS: Record<SettingsId, () => SettingsGroup[]> = {
  neural: cellSettings,
  footprints: footprintSettings,
  position: () => [positionSettings()],
  behavior: () => [annotationSettings()],
};

export function QcSettingsModal(props: { id: SettingsId; onClose: () => void }): JSX.Element {
  return (
    <Modal
      label="QC settings"
      title="QC settings"
      head={<span class="cb-muted">thresholds and pass/fail limits</span>}
      width={520}
      height={560}
      onClose={props.onClose}
    >
      <QcSettingsBody groups={GROUPS[props.id]()} />
    </Modal>
  );
}
