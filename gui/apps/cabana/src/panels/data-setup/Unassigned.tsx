// Files of the selected folder that CaBaNA did not recognize. Each row says only what kind of file
// it is (no guesses about its contents) and has one Actions menu: Assign to ▸ a free data type, a
// named Other type or the experiment details, or Ignore. Files that cannot be read offer only
// Ignore. Shown only while some file is unassigned.

import { Show, For, type JSX } from 'solid-js';
import { ActionsMenu } from '../../components/ActionsMenu.tsx';
import type { MenuItem } from '../../lib/actions-menu.ts';
import { errorText, showMessage } from '../../lib/confirm.ts';
import { assignTo } from '../../lib/data-files.ts';
import { formatBytes } from '../../lib/new-project.ts';
import { identifiedAs } from '../../lib/other-files.ts';
import { BEHAVIOR_ADD, slotOf, type SlotId } from '../../lib/slots.ts';
import {
  dropUnassigned,
  ignoredFiles,
  loaded,
  unrecognized,
  type UnassignedFile,
} from '../../lib/store.ts';

const KIND: Record<string, string> = {
  npy: 'NumPy array',
  npz: 'NumPy archive',
  mat: 'MATLAB file',
  csv: 'Table (.csv)',
  tsv: 'Table (.tsv)',
  txt: 'Text file',
  yaml: 'YAML file',
  yml: 'YAML file',
  json: 'JSON file',
  h5: 'HDF5 file',
  png: 'Image',
  jpg: 'Image',
  jpeg: 'Image',
};
/** Files CaBaNA cannot read, with what to do instead. */
const UNREADABLE: Record<string, string> = {
  xlsx: 'Excel workbook: not read. Save it as .csv to use it.',
  xls: 'Excel workbook: not read. Save it as .csv to use it.',
  docx: 'Word document: not read.',
  doc: 'Word document: not read.',
  pdf: 'PDF: not read.',
};
const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');
export const unreadable = (name: string): string | undefined => UNREADABLE[extOf(name)];
export const kindText = (u: Pick<UnassignedFile, 'name' | 'size'>): string =>
  unreadable(u.name) ??
  `${KIND[extOf(u.name)] ?? (extOf(u.name) ? `.${extOf(u.name)} file` : 'File')} · ${formatBytes(u.size)}`;

const NEURAL: SlotId[] = [
  'neural_timestamps',
  'neural_deconvolved',
  'neural_denoised',
  'neural_raw',
  'footprints',
];
const free = (ids: SlotId[]) => ids.filter((id) => !loaded[id]?.summary);

function menu(u: UnassignedFile): MenuItem[] {
  const assign = (target: SlotId | 'other') => () =>
    void assignTo(u, target).catch((e) =>
      showMessage('Assigning the file did not work', errorText(e)),
    );
  const item = (id: SlotId): MenuItem => ({
    kind: 'action',
    label: slotOf(id).label,
    onSelect: assign(id),
  });
  const ignore: MenuItem = {
    kind: 'action',
    label: 'Ignore',
    onSelect: () => dropUnassigned(u.key, true),
  };
  if (unreadable(u.name)) return [{ kind: 'header', label: 'Cannot be read' }, ignore];
  return [
    {
      kind: 'category',
      label: 'Assign to',
      items: [
        { kind: 'header', label: 'Neural data' },
        ...free(NEURAL).map(item),
        { kind: 'header', label: 'Behavioral data' },
        ...free(['behavior_timestamps', ...BEHAVIOR_ADD]).map(item),
        { kind: 'action', label: 'Other…', onSelect: assign('other') },
        { kind: 'separator' },
        {
          kind: 'action',
          label: 'Experiment details (experiment.yaml)',
          onSelect: assign('config'),
        },
      ],
    },
    { kind: 'separator' },
    ignore,
  ];
}

function Row(props: { u: UnassignedFile }): JSX.Element {
  const reason = () => (props.u.file ? identifiedAs(props.u.file)?.reason : undefined);
  return (
    <div class="cb-ld-unk__row">
      <span class="cb-sp-mono" title={props.u.name}>
        {props.u.name}
      </span>
      <span
        class="cb-ld-unk__desc"
        classList={{ 'cb-ds-tone--warn': !!reason() }}
        title={reason() ?? kindText(props.u)}
      >
        {reason() ?? kindText(props.u)}
      </span>
      <ActionsMenu items={() => menu(props.u)} side="left" />
    </div>
  );
}

export function Unassigned(): JSX.Element {
  const ignored = () => ignoredFiles();
  return (
    <section class="cb-ld-card cb-ld-card--optional cb-ld-unk" aria-label="Unassigned files">
      <header class="cb-ld-card__head">
        <h3>Unassigned</h3>
        <span class="cb-muted">Files in the selected folder not recognized by CaBaNA</span>
        <span class="cb-spacer" />
        <Show when={ignored().length}>
          <span class="cb-muted" title={ignored().join(', ')}>
            Ignored: {ignored().length > 2 ? `${ignored().length} files` : ignored().join(', ')}
          </span>
        </Show>
      </header>
      <div class="cb-ld-unk__rows">
        <For each={unrecognized()}>{(u) => <Row u={u} />}</For>
      </div>
    </section>
  );
}
