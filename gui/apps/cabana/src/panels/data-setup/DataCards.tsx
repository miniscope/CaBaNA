// The Neural data and Behavioral data cards of Data setup. Each row is one data type: a status mark
// (✓, ⚠ or ✕), its name and (i), the file name or the accepted file types, the data shape, then
// Select file, Actions or Locate file, and × on rows added from a + menu. The neural card lists the
// timestamps and, under Neural activity, the deconvolved events and added types; the behavioral
// card lists the timestamps and, under Behavioral activity, the added types and named ones.

import { For, Show, type JSX } from 'solid-js';
import { ActionsMenu } from '../../components/ActionsMenu.tsx';
import type { MenuItem } from '../../lib/actions-menu.ts';
import { qcShown } from '../../lib/analysis-data.ts';
import { confirmAction, errorText, showMessage } from '../../lib/confirm.ts';
import { addRow, addedRows, hideRow, openEntry } from '../../lib/data-setup-view.ts';
import { saveOtherName, selectFileFor, selectFileForOther } from '../../lib/data-files.ts';
import { sectionsFor } from '../../lib/file-sections.ts';
import { setRequirementsTab } from '../../lib/load-data-windows.ts';
import { missingFileOf, openProject, setDataFiles } from '../../lib/open-project.ts';
import {
  addOther,
  others,
  removeOther,
  renameOther,
  setOtherFile,
  type OtherType,
} from '../../lib/other-types.ts';
import { forgetSlot } from '../../lib/project-session.ts';
import { projects } from '../../lib/projects-client.ts';
import { cardActions, rowMark, type RowFacts } from '../../lib/setup-rows.ts';
import {
  BEHAVIOR_ADD,
  extText,
  NEURAL_ADD,
  slotOf,
  type OtherId,
  type SlotId,
} from '../../lib/slots.ts';
import { loaded, removeFile } from '../../lib/store.ts';
import { qcCounts } from './FileQc.tsx';
import { GroupInfo, SlotInfo } from './slot-help.tsx';
import { noteOf } from './slot-text.ts';

/** Height of one row; the data cards are sized in rows. */
const ROW_H = 34;

const isLoaded = (id: SlotId) => !!loaded[id]?.summary && !!loaded[id]!.size;
const present = (id: SlotId) => isLoaded(id) || !!loaded[id]?.error;
/** A row is shown when it is a default row, was added from a + menu, or has a file. */
const shown = (id: SlotId) => addedRows().includes(id) || present(id) || !!missingFileOf(id);
const neuralRows = () => NEURAL_ADD.filter(shown);
const behaviorRows = () => BEHAVIOR_ADD.filter(shown);

function facts(id: SlotId): RowFacts {
  const ok = isLoaded(id);
  return {
    level: slotOf(id).level,
    loaded: ok,
    error: loaded[id]?.error,
    note: ok ? noteOf(id) : undefined,
    qc: ok && sectionsFor(id).includes('qc') && qcShown(id) ? qcCounts(id) : undefined,
  };
}

/** Run an action that may fail (a dialog, the engine) and say why when it does. */
const attempt = (what: string, f: () => Promise<void>) =>
  void f().catch((e) => showMessage(`${what} did not work`, errorText(e)));

function removeData(id: SlotId, then?: () => void): void {
  const name = loaded[id]?.name ?? missingFileOf(id)?.name ?? 'this file';
  confirmAction({
    title: 'Remove file?',
    message: `Remove ${name} from this project? The original file is not changed.`,
    confirmLabel: 'Remove file',
    danger: true,
    onConfirm: () => {
      removeFile(id);
      void forgetSlot(id);
      then?.();
    },
  });
}

const rowMenu = (id: SlotId): MenuItem[] => {
  const f = facts(id);
  const mark = rowMark(f);
  return [
    { kind: 'header', label: loaded[id]?.name ?? '' },
    ...(cardActions(f).view
      ? [
          {
            kind: 'action',
            label: 'View data',
            hint: mark.mark === '✓' ? undefined : mark.text.replace(/^Loaded · /, ''),
            onSelect: () => openEntry(id),
          } as MenuItem,
        ]
      : []),
    {
      kind: 'action',
      label: 'Replace file…',
      onSelect: () => attempt('Replace file', () => selectFileFor(id)),
    },
    { kind: 'separator' },
    { kind: 'action', label: 'Remove file', danger: true, onSelect: () => removeData(id) },
  ];
};

/** One data type. `sub` rows sit under an activity heading; `removable` ones came from a + menu. */
function SlotRow(props: { id: SlotId; sub?: boolean; removable?: boolean }): JSX.Element {
  const s = () => slotOf(props.id);
  const gone = () => (present(props.id) ? undefined : missingFileOf(props.id));
  const mark = () =>
    gone()
      ? {
          mark: '✕',
          tone: 'fail',
          text: `Missing: last seen at ${gone()!.last_seen_path ?? gone()!.path}`,
        }
      : rowMark(facts(props.id));
  const file = () => loaded[props.id]?.name ?? gone()?.name;
  return (
    <div class="cb-ld-row" classList={{ 'cb-ld-row--sub': props.sub }}>
      <span
        class={`cb-ld-row__mark cb-ds-tone--${mark().tone}`}
        title={mark().mark ? mark().text : undefined}
        role={mark().mark ? 'img' : undefined}
        aria-label={mark().mark ? mark().text : undefined}
      >
        {mark().mark}
      </span>
      <span class="cb-ld-row__name">
        {s().label}
        <SlotInfo id={props.id} />
        <Show when={file()} fallback={<span class="cb-ld-row__ext">{extText(s())}</span>}>
          <span
            class="cb-ld-row__file"
            classList={{ 'cb-ld-row__file--missing': !!gone() }}
            title={file()}
          >
            {file()}
          </span>
          <Show when={gone()}>
            <span class="cb-ds-tone--fail">Missing</span>
          </Show>
        </Show>
      </span>
      <Show when={loaded[props.id]?.shape} fallback={<span />}>
        <span class="cb-ld-shape">{loaded[props.id]!.shape}</span>
      </Show>
      <span>
        <Show
          when={present(props.id)}
          fallback={
            <button
              type="button"
              class="btn-secondary btn-small"
              onClick={() => attempt('Select file', () => selectFileFor(props.id))}
            >
              {gone() ? 'Locate file' : 'Select file'}
            </button>
          }
        >
          <ActionsMenu items={() => rowMenu(props.id)} />
        </Show>
      </span>
      <Show when={props.removable} fallback={<span />}>
        <button
          type="button"
          class="cb-ld-x"
          title={`Remove ${s().label} from this card`}
          aria-label={`Remove ${s().label}`}
          onClick={() =>
            present(props.id) || gone()
              ? removeData(props.id, () => hideRow(props.id))
              : hideRow(props.id)
          }
        >
          ×
        </button>
      </Show>
    </div>
  );
}

async function forgetOther(o: OtherType): Promise<void> {
  const project = openProject();
  if (o.file?.path && project) {
    await projects.removeData(project.id, o.id);
    setDataFiles(await projects.listData(project.id));
  }
}

/** A data type the user named: its name is typed in the row; the file is listed, never read. */
function OtherRow(props: { o: OtherType }): JSX.Element {
  const id = () => props.o.id as OtherId;
  const menu = (): MenuItem[] => [
    { kind: 'header', label: props.o.file?.name ?? '' },
    {
      kind: 'action',
      label: 'Replace file…',
      onSelect: () => attempt('Replace file', () => selectFileForOther(id())),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Remove file',
      danger: true,
      onSelect: () =>
        attempt('Remove file', async () => {
          await forgetOther(props.o);
          setOtherFile(id(), undefined);
        }),
    },
  ];
  return (
    <div class="cb-ld-row cb-ld-row--sub">
      <span class="cb-ld-row__mark cb-ds-tone--ok">{props.o.file ? '✓' : ''}</span>
      <span class="cb-ld-row__name">
        <input
          type="text"
          data-other={props.o.id}
          value={props.o.name}
          placeholder="Name this data type"
          aria-label="Name of this data type"
          onInput={(e) => renameOther(id(), e.currentTarget.value)}
          onChange={() => attempt('Saving the name', () => saveOtherName(id()))}
        />
        <GroupInfo label="Other data">
          <p>
            A data type CaBaNA does not list. Name it, then add its file. It is listed with the
            project’s files; CaBaNA does not check or analyze its contents.
          </p>
        </GroupInfo>
        <Show when={props.o.file} fallback={<span class="cb-ld-row__ext">any file type</span>}>
          <span class="cb-ld-row__file" title={props.o.file!.name}>
            {props.o.file!.name}
          </span>
        </Show>
      </span>
      <span />
      <span>
        <Show
          when={props.o.file}
          fallback={
            <button
              type="button"
              class="btn-secondary btn-small"
              onClick={() => attempt('Select file', () => selectFileForOther(id()))}
            >
              Select file
            </button>
          }
        >
          <ActionsMenu items={menu} />
        </Show>
      </span>
      <button
        type="button"
        class="cb-ld-x"
        title={`Remove ${props.o.name || 'this data type'} from this card`}
        aria-label={`Remove ${props.o.name || 'this data type'}`}
        onClick={() =>
          attempt('Remove', async () => {
            await forgetOther(props.o);
            removeOther(id());
          })
        }
      >
        ×
      </button>
    </div>
  );
}

/** A heading row at the level of the timestamps row, with its (i) and a square + menu. */
function GroupRow(props: {
  title: string;
  menuLabel: string;
  items: () => MenuItem[];
  children: JSX.Element;
}): JSX.Element {
  return (
    <div class="cb-ld-row cb-ld-row--group">
      <span />
      <span class="cb-ld-row__name">
        <strong>{props.title}</strong>
        <GroupInfo label={props.title}>{props.children}</GroupInfo>
        <ActionsMenu
          label="+"
          caret={false}
          title={props.menuLabel}
          class="btn-secondary btn-small cb-ld-sq"
          items={props.items}
        />
      </span>
      <span />
      <span />
      <span />
    </div>
  );
}

const neuralMenu = (): MenuItem[] => [
  { kind: 'header', label: 'Add neural data' },
  ...NEURAL_ADD.map((id): MenuItem => ({
    kind: 'action',
    label: slotOf(id).label,
    hint: slotOf(id).level,
    mark: shown(id),
    onSelect: () => addRow(id),
  })),
];

/** Focus the name field of a new named data type once it is drawn. */
const focusOther = (id: OtherId) =>
  requestAnimationFrame(() =>
    document.querySelector<HTMLInputElement>(`[data-other="${id}"]`)?.focus(),
  );

const behaviorMenu = (): MenuItem[] => [
  { kind: 'header', label: 'Add behavioral data' },
  ...BEHAVIOR_ADD.map((id): MenuItem => ({
    kind: 'action',
    label: slotOf(id).label,
    hint: id === 'behavior_frame' ? 'still image' : undefined,
    mark: shown(id),
    onSelect: () => addRow(id),
  })),
  { kind: 'separator' },
  { kind: 'action', label: 'Other…', mark: false, onSelect: () => focusOther(addOther()) },
];

function DataCard(props: {
  title: string;
  tab: 'neural' | 'behavior';
  rows: number;
  children: JSX.Element;
}): JSX.Element {
  return (
    <section class="cb-ld-card" aria-label={props.title}>
      <header class="cb-ld-card__head">
        <h3>{props.title}</h3>
        <span class="cb-spacer" />
        <button
          type="button"
          class="btn-secondary btn-small cb-ld-reqbtn"
          onClick={() => setRequirementsTab(props.tab)}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0" />
            <path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0" />
            <path d="M3 6v13M12 6v13M21 6v13" />
          </svg>
          Data requirements
        </button>
      </header>
      <div class="cb-ld-card__rows" style={{ height: `${props.rows * ROW_H}px` }}>
        {props.children}
      </div>
    </section>
  );
}

/** Both data cards are as tall as their rows need, and at least 4 rows taller than the defaults. */
const cardRows = () =>
  Math.max(3 + 4, 3 + neuralRows().length, 2 + Math.max(1, behaviorRows().length + others.length));

export function DataCards(): JSX.Element {
  return (
    <div class="cb-ld-grid cb-ld-grid--data">
      <DataCard title="Neural data" tab="neural" rows={cardRows()}>
        <SlotRow id="neural_timestamps" />
        <GroupRow title="Neural activity" menuLabel="Add neural data" items={neuralMenu}>
          <p>
            <b>Required:</b> deconvolved events, the neural data every analysis reads.
          </p>
          <p>
            <b>Recommended:</b> denoised traces, used to check the deconvolution, and footprints for
            the cell map.
          </p>
          <p>
            <b>Optional:</b> raw traces, used to check each cell’s signal to noise. Add any of them
            with <b>+</b>.
          </p>
        </GroupRow>
        <SlotRow id="neural_deconvolved" sub />
        <For each={neuralRows()}>{(id) => <SlotRow id={id} sub removable />}</For>
      </DataCard>
      <DataCard title="Behavioral data" tab="behavior" rows={cardRows()}>
        <SlotRow id="behavior_timestamps" />
        <GroupRow title="Behavioral activity" menuLabel="Add behavioral data" items={behaviorMenu}>
          <p>
            <b>Required:</b> at least one file. Usually this is position.
          </p>
          <p>
            Add as many as you have with <b>+</b>: position, behavior annotations, zone annotations,
            head orientation, time markers, frame labels, or another data type with Other…
          </p>
          <p>
            <b>Optional:</b> a behavior video frame, a still image the arena editor uses as its
            background.
          </p>
        </GroupRow>
        <Show
          when={behaviorRows().length || others.length}
          fallback={
            <div class="cb-ld-row cb-ld-row--sub cb-ld-row--hint">
              <span />
              <span>
                Add at least one data type here, often position or annotated behavior bouts.
              </span>
            </div>
          }
        >
          <For each={behaviorRows()}>{(id) => <SlotRow id={id} sub removable />}</For>
          <For each={others}>{(o) => <OtherRow o={o} />}</For>
        </Show>
      </DataCard>
    </div>
  );
}
