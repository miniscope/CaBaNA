// Organizing your data folder: a suggested folder with the name keywords CaBaNA matches
// highlighted (the patterns of lib/slots.ts), how files are assigned, and naming tips.

import { For, type JSX } from 'solid-js';
import { Modal } from '../../components/Modal.tsx';
import { setFolderHelpOpen } from '../../lib/load-data-windows.ts';

// Each line of the tree: plain text, or [class, text] for a folder (d), comment (c) or keyword (k).
type Part = string | ['d' | 'c' | 'k', string];
const TREE: Part[][] = [
  [['d', 'm42_openfield_day3/'], '          ', ['c', 'one recording']],
  ['├── ', ['d', 'neural/']],
  ['│   ├── ', ['k', 'neural_timestamp'], 's.csv'],
  ['│   ├── neural_', ['k', 'raw'], '.npy'],
  ['│   ├── neural_', ['k', 'denois'], 'ed.npy'],
  ['│   ├── neural_', ['k', 'deconv'], 'olved.npy'],
  ['│   └── ', ['k', 'footprint'], 's.npy'],
  ['├── ', ['d', 'behavior/']],
  ['│   ├── ', ['k', 'behavior_timestamp'], 's.csv'],
  ['│   ├── ', ['k', 'position'], '.csv'],
  ['│   ├── behavior_frame', ['k', '.png'], '    ', ['c', 'any .png or .jpg']],
  ['│   ├── ', ['k', 'zone'], '_annotations.csv'],
  ['│   ├── investigation_', ['k', 'annotation'], 's.csv'],
  ['│   └── time_', ['k', 'marker'], 's.csv'],
  ['├── ', ['k', 'experiment'], '.yaml           ', ['c', 'experiment details']],
  ['└── behavCam.avi              ', ['c', 'ignored']],
];

function Tree(): JSX.Element {
  return (
    <pre class="cb-ld-tree">
      <For each={TREE}>
        {(line, i) => (
          <>
            {i() ? '\n' : ''}
            <For each={line}>
              {(p) => (typeof p === 'string' ? p : <span class={p[0]}>{p[1]}</span>)}
            </For>
          </>
        )}
      </For>
    </pre>
  );
}

export function FolderStructure(): JSX.Element {
  const close = () => setFolderHelpOpen(false);
  return (
    <Modal
      label="Organizing your data folder"
      title="Organizing your data folder"
      width={860}
      onClose={close}
      footer={
        <>
          <span class="cb-spacer" />
          <button type="button" class="btn-secondary btn-small" onClick={close}>
            Close
          </button>
        </>
      }
    >
      <div class="cb-ld-dlg cb-ld-treewrap">
        <div>
          <h4>Suggested structure</h4>
          <Tree />
          <p class="cb-ld-small cb-muted">
            Subfolders are optional; CaBaNA looks one level inside them. Keep one recording per
            folder.
          </p>
        </div>
        <div class="cb-muted">
          <h4>How CaBaNA assigns files</h4>
          <ol class="cb-ld-steps">
            <li>
              Each file name is checked for the words highlighted on the left (case does not
              matter). A position file’s name starts with “position”.
            </li>
            <li>
              A file whose name does not decide it goes to <b>Unassigned</b>, where you assign or
              ignore it.
            </li>
            <li>Videos are ignored. A .png or .jpg image is taken as the behavior video frame.</li>
          </ol>
          <h4 style={{ 'margin-top': '12px' }}>Naming tips</h4>
          <ol class="cb-ld-steps">
            <li>
              Keep the keyword anywhere in the name:{' '}
              <span class="cb-sp-mono">m42_deconvolved_S.npy</span> works.
            </li>
            <li>
              Use one keyword per file; <span class="cb-sp-mono">raw_and_denoised.npy</span> is
              ambiguous.
            </li>
          </ol>
          <h4 style={{ 'margin-top': '12px' }}>If a file lands in the wrong place</h4>
          <p>
            Use the row’s Actions menu to replace or remove the file, or × to remove the data type.
            Nothing on disk is moved or renamed.
          </p>
        </div>
      </div>
    </Modal>
  );
}
