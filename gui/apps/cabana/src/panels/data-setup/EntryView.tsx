// The Data setup pop-ups that have no window of their own: the timestamp alignment check, and an
// empty data type to load (reached from a missing-file link). Loaded files open in ViewData.tsx,
// the experimental setup in ExperimentalSetup.tsx, the arena in ArenaEditor.tsx.

import { createSignal, Show, type JSX } from 'solid-js';
import { Modal } from '../../components/Modal.tsx';
import { closeEntry, entry, popupOpen } from '../../lib/data-setup-view.ts';
import { SLOTS, type Slot } from '../../lib/slots.ts';
import { addFiles, loaded } from '../../lib/store.ts';
import { InfoTip } from '../InfoTip.tsx';
import { FileButton } from '../Preview.tsx';
import { FileQc } from './FileQc.tsx';
import { accepted, slotLabel } from './slot-text.ts';

function EmptySlot(props: { slot: Slot }): JSX.Element {
  const [over, setOver] = createSignal(false);
  const info = () => loaded[props.slot.id];
  return (
    <>
      <p class="cb-muted cb-ds-meta">{props.slot.format}</p>
      <Show when={info()?.error}>
        <p class="cb-error">
          {info()!.name}: {info()!.error}
        </p>
      </Show>
      <div
        class="cb-ds-drop"
        classList={{ 'cb-ds-drop--over': over() }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          const f = e.dataTransfer?.files?.[0];
          if (f) void addFiles([f], props.slot.id);
        }}
      >
        <p>Drop the {slotLabel(props.slot).toLowerCase()} file here</p>
        <FileButton slot={props.slot.id} primary />
        <p class="cb-muted">
          Accepted file types: <code>{accepted(props.slot)}</code>
        </p>
      </div>
    </>
  );
}

/** The open entry in its pop-up. */
export function EntryPopup(): JSX.Element {
  const slot = () => SLOTS.find((s) => s.id === entry() && s.id !== 'config');
  const title = () =>
    entry() === 'sync' ? 'Timestamp alignment' : slot() ? slotLabel(slot()!) : '';
  return (
    <Show when={popupOpen() && (entry() === 'sync' || slot())}>
      <Modal
        label={title()}
        title={title()}
        head={
          entry() === 'sync' ? (
            <>
              <span class="cb-muted">Cross-data check</span>
              <InfoTip label="About Timestamp alignment">
                Dropped frames, frame-time jitter, and whether the miniscope and behavior camera
                clocks line up after the clock offset and scale in the experimental setup.
              </InfoTip>
            </>
          ) : (
            <InfoTip label={`About ${title()}`}>{slot()!.format}</InfoTip>
          )
        }
        onClose={closeEntry}
      >
        <div class="cb-gs-section cb-ds-entry">
          <Show
            when={slot()}
            fallback={
              <div class="cb-ds-body">
                <FileQc />
              </div>
            }
          >
            {(s) => <EmptySlot slot={s()} />}
          </Show>
        </div>
      </Modal>
    </Show>
  );
}
