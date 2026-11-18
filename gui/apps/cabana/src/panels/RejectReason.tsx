// A Reject button that asks why before rejecting: one reason from a short list, with a note
// (required for Other). The reason is kept with the rejection; which cells are rejected, and so
// left out of the analyses, is decided exactly as before.

import { createSignal, For, Show, type JSX } from 'solid-js';
import { cellsText } from '../lib/changes-log.ts';
import { REASONS, reasonReady, reasonText, type Reason } from '../lib/reject-reasons.ts';
import { rejectCells } from '../lib/store.ts';
import { Popover } from './Popover.tsx';

export function RejectButton(props: {
  cells: () => number[];
  label: string;
  class: string;
  /** Preselected reason and note, e.g. for one cell of an overlapping pair. */
  suggest?: Reason;
  note?: string;
  disabled?: boolean;
}): JSX.Element {
  const [anchor, setAnchor] = createSignal<HTMLElement>();
  return (
    <>
      <button
        type="button"
        class={props.class}
        disabled={props.disabled || !props.cells().length}
        aria-haspopup="dialog"
        aria-expanded={!!anchor()}
        onClick={(e) => setAnchor((a) => (a ? undefined : e.currentTarget))}
      >
        {props.label}
      </button>
      <Show when={anchor()}>
        {(a) => (
          <ReasonForm
            anchor={a()}
            cells={props.cells()}
            initialReason={props.suggest}
            initialNote={props.note}
            onClose={() => setAnchor()}
          />
        )}
      </Show>
    </>
  );
}

function ReasonForm(props: {
  anchor: HTMLElement;
  cells: number[];
  initialReason?: Reason;
  initialNote?: string;
  onClose: () => void;
}): JSX.Element {
  const [reason, setReason] = createSignal<Reason | undefined>(props.initialReason);
  const [note, setNote] = createSignal(props.initialNote ?? '');
  const name = `reject-reason-${Math.random().toString(36).slice(2)}`;
  const submit = (e: Event) => {
    e.preventDefault();
    if (!reasonReady(reason(), note())) return;
    rejectCells(props.cells, reasonText(reason()!, note()));
    props.onClose();
  };
  return (
    <Popover anchor={props.anchor} onClose={props.onClose} width={320} label="Reason for rejecting">
      <form class="cb-rjr" onSubmit={submit}>
        <fieldset>
          <legend>
            <strong>Reject {cellsText(props.cells).toLowerCase()}: why?</strong>
          </legend>
          <For each={REASONS}>
            {(r) => (
              <label class="cb-rjr__opt">
                <input
                  type="radio"
                  name={name}
                  checked={reason() === r}
                  onChange={() => setReason(r)}
                />
                {r === 'Other' ? 'Other (with note)' : r}
              </label>
            )}
          </For>
        </fieldset>
        <label class="cb-rjr__note">
          <span class="cb-muted">Note{reason() === 'Other' ? ' (required)' : ' (optional)'}</span>
          <input
            type="text"
            value={note()}
            onInput={(e) => setNote(e.currentTarget.value)}
            placeholder={reason() === 'Duplicate of another cell' ? 'e.g. overlaps cell 12' : ''}
          />
        </label>
        <p class="cb-muted cb-rjr__hint">
          Kept with the rejection and listed in Changes. Rejected cells are left out of every
          analysis; Restore puts a cell back.
        </p>
        <div class="cb-rjr__actions">
          <button type="button" class="btn-secondary btn-small" onClick={() => props.onClose()}>
            Cancel
          </button>
          <button
            type="submit"
            class="btn-primary btn-small"
            disabled={!reasonReady(reason(), note())}
            title={reasonReady(reason(), note()) ? undefined : 'Choose a reason first'}
          >
            Reject
          </button>
        </div>
      </form>
    </Popover>
  );
}
