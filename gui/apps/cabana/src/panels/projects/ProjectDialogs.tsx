// The small pop-ups of project management: rename, clear session data, delete a project.

import { createSignal, untrack, type JSX } from 'solid-js';
import { Modal } from '../../components/Modal.tsx';

/** A pop-up with a short message and Cancel / confirm buttons. */
function Confirm(props: {
  title: string;
  confirmLabel: string;
  /** Red confirm button, for what cannot be undone. */
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children: JSX.Element;
}): JSX.Element {
  return (
    <Modal
      label={props.title}
      title={props.title}
      width={460}
      onClose={props.onClose}
      footer={
        <>
          <span class="cb-spacer" />
          <button type="button" class="btn-secondary btn-small" onClick={props.onClose}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary btn-small"
            classList={{ 'cb-btn-danger': props.danger }}
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </button>
        </>
      }
    >
      <p class="cb-muted cb-dlg__text">{props.children}</p>
    </Modal>
  );
}

export function ClearSessionDialog(props: {
  name: string;
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <Confirm
      title="Clear session data?"
      confirmLabel="Clear session data"
      danger
      onConfirm={props.onConfirm}
      onClose={props.onClose}
    >
      Closes {props.name} in this window: the loaded files and settings in this window are cleared.
      Original files are never changed, and the settings this browser kept for it stay in the
      Project Library.
    </Confirm>
  );
}

/** Wired up with saved projects; the engine moves the project folder to the Trash. */
export function DeleteProjectDialog(props: {
  name: string;
  /** "64.3 MB", when known. */
  size?: string;
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <Confirm
      title={`Delete ${props.name}?`}
      confirmLabel="Move to Trash"
      danger
      onConfirm={props.onConfirm}
      onClose={props.onClose}
    >
      The project folder (settings, history, results{props.size ? `, ${props.size}` : ''}) moves to
      the Trash and the project leaves the library. Your original data files are not touched.
    </Confirm>
  );
}

export function RenameDialog(props: {
  name: string;
  onRename: (name: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [value, setValue] = createSignal(untrack(() => props.name));
  const ok = () => value().trim().length > 0;
  const submit = () => ok() && props.onRename(value().trim());
  return (
    <Modal
      label="Rename project"
      title="Rename project"
      width={460}
      onClose={props.onClose}
      footer={
        <>
          <span class="cb-spacer" />
          <button type="button" class="btn-secondary btn-small" onClick={props.onClose}>
            Cancel
          </button>
          <button type="button" class="btn-primary btn-small" disabled={!ok()} onClick={submit}>
            Rename
          </button>
        </>
      }
    >
      <label class="cb-dlg__field">
        <span>Project name</span>
        <input
          type="text"
          value={value()}
          onInput={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          ref={(el) => queueMicrotask(() => el.select())}
        />
      </label>
    </Modal>
  );
}
