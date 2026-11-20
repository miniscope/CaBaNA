// Data requirements: one window with a Neural data and a Behavioral data tab, opened on the tab of
// the card it came from. A tile per data type: drawing, name, level, one line and an example name.

import { For, Show, type JSX } from 'solid-js';
import { Modal } from '../../components/Modal.tsx';
import { requirementsTab, setRequirementsTab } from '../../lib/load-data-windows.ts';
import { slotOf, type SlotId } from '../../lib/slots.ts';
import { HelpMark } from '../../components/HelpMark.tsx';
import { ILLUSTRATION } from './data-illustrations.tsx';
import { SLOT_HELP } from './slot-help.tsx';

type Badge = 'req' | 'rec' | 'opt' | 'one';
const BADGE: Record<Badge, [string, string]> = {
  req: ['cb-ld-badge--req', 'Required'],
  rec: ['', 'Recommended'],
  opt: ['', 'Optional'],
  one: ['cb-ld-badge--one', 'Activity'],
};

const TABS = {
  neural: {
    label: 'Neural data',
    lead: 'neural timestamps and deconvolved events. Denoised traces and footprints are recommended; raw traces are optional.',
    tiles: [
      ['neural_timestamps', 'req'],
      ['neural_deconvolved', 'req'],
      ['neural_denoised', 'rec'],
      ['footprints', 'rec'],
      ['neural_raw', 'opt'],
    ] as [SlotId, Badge][],
  },
  behavior: {
    label: 'Behavioral data',
    lead: 'behavioral timestamps and at least one behavioral activity data type, usually position or annotated behavior bouts.',
    tiles: [
      ['behavior_timestamps', 'req'],
      ['position', 'one'],
      ['behavior_annotations', 'one'],
      ['zone_annotations', 'one'],
      ['head_orientation', 'one'],
      ['time_markers', 'one'],
      ['frame_labels', 'one'],
      ['behavior_frame', 'opt'],
      ['other', 'one'],
    ] as [SlotId | 'other', Badge][],
  },
};

const firstSentence = (t: string) => `${t.split('. ')[0].replace(/\.$/, '')}.`;

function Tile(props: { id: SlotId | 'other'; badge: Badge }): JSX.Element {
  const label = () => (props.id === 'other' ? 'Other' : slotOf(props.id).label);
  const what = () =>
    props.id === 'other'
      ? 'A data type not listed here. Name it and select its file.'
      : firstSentence(SLOT_HELP[props.id].what);
  return (
    <div class="cb-ld-tile">
      {ILLUSTRATION[props.id]()}
      <div class="cb-ld-tile__head">
        <b>{label()}</b>
        <span class={`cb-ld-badge ${BADGE[props.badge][0]}`}>{BADGE[props.badge][1]}</span>
      </div>
      <p>{what()}</p>
      <code title={props.id === 'other' ? 'Any file' : slotOf(props.id).format}>
        {props.id === 'other' ? 'any file type' : slotOf(props.id).file}
      </code>
    </div>
  );
}

export function DataRequirements(): JSX.Element {
  const tab = () => requirementsTab() ?? 'neural';
  return (
    <Modal
      label="Data requirements"
      title="Data requirements"
      width={860}
      onClose={() => setRequirementsTab(undefined)}
    >
      <div class="cb-ld-dlg">
        <div class="cb-ld-tabs" role="tablist">
          <For each={['neural', 'behavior'] as const}>
            {(id) => (
              <button
                type="button"
                role="tab"
                aria-selected={tab() === id}
                class="cb-ld-tab"
                classList={{ 'cb-ld-tab--on': tab() === id }}
                onClick={() => setRequirementsTab(id)}
              >
                {TABS[id].label}
              </button>
            )}
          </For>
        </div>
        <p class="cb-ld-lead">
          <b>Required:</b> {TABS[tab()].lead}
        </p>
        <Show when={tab() === 'behavior'}>
          <p class="cb-ld-small">
            <span class="cb-ld-badge cb-ld-badge--one">Activity</span> behavioral activity: add at
            least one, as many as you have.
          </p>
        </Show>
        <div class="cb-ld-tiles">
          <For each={TABS[tab()].tiles}>{([id, badge]) => <Tile id={id} badge={badge} />}</For>
        </div>
        <p class="cb-ld-small">
          Tables are <b>.csv</b>; neural arrays are <b>.npy</b>, <b>.npz</b> or <b>.mat</b>; the
          behavior video frame is <b>.png</b> or <b>.jpg</b>. Each data type’s <HelpMark /> gives
          its exact columns and where to get it.
        </p>
      </div>
    </Modal>
  );
}
