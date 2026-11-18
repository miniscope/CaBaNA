// Export a copy of the experimental setup as a YAML file. This project keeps its own setup; the
// copy is a template for the next project (Apply settings from another project).

import { createSignal, type JSX } from 'solid-js';
import { Modal } from '../../components/Modal.tsx';
import { downloadYaml, sessionYaml, templateYaml } from '../../lib/session-config.ts';

const DEFAULT_NAME = 'experiment.yaml';

/** A file name that ends in .yaml, without folder characters. */
const fileName = (typed: string): string => {
  const name = typed.trim().replace(/[\\/:*?"<>|]/g, '-') || DEFAULT_NAME;
  return /\.ya?ml$/i.test(name) ? name : `${name}.yaml`;
};

export function ExportCopy(props: { onClose: () => void }): JSX.Element {
  const [name, setName] = createSignal(DEFAULT_NAME);
  const [leaveOut, setLeaveOut] = createSignal(true);
  const save = () => {
    downloadYaml(leaveOut() ? templateYaml() : sessionYaml(), fileName(name()));
    props.onClose();
  };
  return (
    <Modal
      label="Export a copy of experiment.yaml"
      title="Export a copy of experiment.yaml"
      width={620}
      height={400}
      onClose={props.onClose}
      actions={
        <button type="button" class="btn-primary btn-small" onClick={save}>
          Export
        </button>
      }
    >
      <div class="cb-dlg">
        <label class="cb-dlg__row">
          <span class="cb-muted">File name</span>
          <input
            type="text"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </label>
        <p class="cb-muted cb-dlg__note">The browser saves the file to its downloads folder.</p>
        <label class="cb-dlg__check">
          <input
            type="checkbox"
            checked={leaveOut()}
            onChange={(e) => setLeaveOut(e.currentTarget.checked)}
          />
          Leave out this animal's details (session name, subject ID, file names, clock offset and
          scale)
        </label>
        <p class="cb-muted cb-dlg__note">
          This project keeps using its own experiment.yaml. The copy is a template: bring it into
          the next project with Experimental setup, Actions, Load a config file.
        </p>
      </div>
    </Modal>
  );
}
