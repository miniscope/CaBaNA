// The Revert changes window of a Data visualization box: every correction and preprocessing
// setting applied to that box's data, each ticked to undo. Reverting uses the actions of the
// Changes drawer; original files are never touched.

import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { Modal } from '../components/Modal.tsx';
import { ANALYSES } from '../lib/analyses.ts';
import { lastApplied } from '../lib/changes-log.ts';
import { stepsAtDefault } from '../lib/changes.ts';
import { DEFAULT_PREP, prep } from '../lib/preprocess.ts';
import { stepValues } from '../lib/prep-log.ts';
import { statusOfItem } from '../lib/readiness-snapshot.ts';
import { BOX_TITLE, forBox, type VizBox } from '../lib/viz-pills.ts';
import { rerunAnalyses, rerunNote, revertRows, type RevertRow } from '../lib/viz-revert.ts';
import { changes, revertEntries, when } from './ChangesDrawer.tsx';

export const [revertBox, setRevertBox] = createSignal<VizBox | undefined>();

/** Applied items of a box, then its settings that are still at their defaults. */
const rowsFor = (box: VizBox): RevertRow[] =>
  revertRows(
    forBox(changes(), box),
    forBox(stepsAtDefault({ ...prep }, DEFAULT_PREP), box).map((d) => ({
      ...d,
      value: stepValues(d.step, DEFAULT_PREP),
    })),
    (ref) => when(lastApplied(ref)),
  );

function Row(props: {
  row: RevertRow;
  checked: boolean;
  onToggle: (on: boolean) => void;
}): JSX.Element {
  return (
    <label class="cb-rvt__row" classList={{ 'cb-rvt__row--idle': props.row.idle }}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.row.idle}
        onChange={(e) => props.onToggle(e.currentTarget.checked)}
      />
      <span>
        {props.row.what}
        <span class="cb-rvt__note">{props.row.note}</span>
      </span>
      <span class="cb-rvt__to">{props.row.restore}</span>
    </label>
  );
}

function Section(props: {
  title: string;
  rows: RevertRow[];
  picked: Set<string>;
  onToggle: (ref: string, on: boolean) => void;
}): JSX.Element {
  return (
    <Show when={props.rows.length}>
      <div class="sc cb-rvt__title">{props.title}</div>
      <For each={props.rows}>
        {(r) => (
          <Row
            row={r}
            checked={props.picked.has(r.ref)}
            onToggle={(on) => props.onToggle(r.ref, on)}
          />
        )}
      </For>
    </Show>
  );
}

export function RevertChanges(): JSX.Element {
  return <Show when={revertBox()}>{(box) => <RevertWindow box={box()} />}</Show>;
}

function RevertWindow(props: { box: VizBox }): JSX.Element {
  const rows = createMemo(() => rowsFor(props.box));
  const [picked, setPicked] = createSignal(new Set<string>());
  const toggle = (ref: string, on: boolean) =>
    setPicked((p) => new Set(on ? [...p, ref] : [...p].filter((r) => r !== ref)));
  const chosen = () => rows().filter((r) => r.entry && picked().has(r.ref));
  const note = () =>
    rerunNote(
      rerunAnalyses(
        chosen().map((r) => r.ref),
        // A saved result is one that is current or out of date.
        ANALYSES.filter((a) => ['complete', 'outdated'].includes(statusOfItem(a.id).kind)).map(
          (a) => a.id,
        ),
      ),
    );
  const revert = () => {
    revertEntries(chosen().map((r) => r.entry!));
    setRevertBox();
  };
  return (
    <Modal
      label="Revert changes"
      title={`Revert changes · ${BOX_TITLE[props.box]}`}
      width={720}
      height={470}
      actions={
        <button
          type="button"
          class="btn-primary btn-small"
          disabled={!chosen().length}
          onClick={revert}
        >
          Revert selected ({chosen().length})
        </button>
      }
      onClose={() => setRevertBox()}
    >
      <p class="cb-rvt__orig">
        Original files are not changed. Reverting only removes corrections and settings applied in
        CaBaNA.
      </p>
      <Section
        title="QC corrections"
        rows={rows().filter((r) => r.group === 'correction')}
        picked={picked()}
        onToggle={toggle}
      />
      <Section
        title="Preprocessing"
        rows={rows().filter((r) => r.group === 'prep')}
        picked={picked()}
        onToggle={toggle}
      />
      <Show when={!rows().length}>
        <p class="cb-muted">Nothing has been applied to this data.</p>
      </Show>
      <Show when={note()}>{(text) => <p class="cb-rvt__rerun">{text()}</p>}</Show>
    </Modal>
  );
}
