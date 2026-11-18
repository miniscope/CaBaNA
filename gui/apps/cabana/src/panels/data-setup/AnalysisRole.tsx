// Analysis data and Reference data: the tag each neural trace file carries, and the one
// explanation of what the two roles mean, opened from a tag, the Neural heading or a file's strip.

import { For, Show, type JSX } from 'solid-js';
import {
  analysisKind,
  analysisSlot,
  isReference,
  loadedLayers,
  NEURAL_LAYERS,
  qcShown,
  setAnalysisData,
  type NeuralKind,
} from '../../lib/analysis-data.ts';
import { sectionsFor } from '../../lib/file-sections.ts';
import type { SlotId } from '../../lib/slots.ts';
import { PopButton } from '../QcParts.tsx';
import { HelpMark } from '../../components/HelpMark.tsx';

export type Role = 'analysis' | 'reference';

/** The role of a loaded neural trace file; footprints and timestamps have none. */
export const roleOf = (slot: SlotId): Role | undefined =>
  slot === analysisSlot() ? 'analysis' : isReference(slot) ? 'reference' : undefined;

export const ROLE_NAME: Record<Role, string> = {
  analysis: 'Analysis data',
  reference: 'Reference data',
};

export function RoleHelp(): JSX.Element {
  return (
    <div class="cb-ds-rolehelp">
      <p>
        <span class="cb-ds-tag cb-ds-tag--analysis">Analysis data</span> The one neural file every
        analysis reads, usually the deconvolved events. Its QC is recommended, and its preprocessing
        applies to every result.
      </p>
      <p>
        <span class="cb-ds-tag cb-ds-tag--reference">Reference data</span> Other neural files you
        loaded. They are not analyzed; CaBaNA uses them to check the analysis data (raw traces for
        each cell's signal to noise, denoised traces for the deconvolution check). Their QC is
        optional and off at first, and preprocessing does not apply to them.
      </p>
      <p class="cb-muted">
        To change it, use "Use as analysis data" on a neural file, or the Analysis data field in
        Experiment config, Neural acquisition. It is saved to config.yaml as{' '}
        <code>neural.file</code>.
      </p>
    </div>
  );
}

/** A tag in a list row: not a control of its own, since the row is one. */
export function RoleTag(props: { slot: SlotId }): JSX.Element {
  return (
    <Show when={roleOf(props.slot)}>
      {(r) => <span class={`cb-ds-tag cb-ds-tag--${r()}`}>{ROLE_NAME[r()]}</span>}
    </Show>
  );
}

/** A tag that opens the explanation. */
export function RoleTagButton(props: { slot: SlotId }): JSX.Element {
  return (
    <Show when={roleOf(props.slot)}>
      {(r) => (
        <PopButton
          label={`${ROLE_NAME[r()]}: what does this mean?`}
          title="Analysis data and reference data"
          width={380}
          class={`cb-ds-tag cb-ds-tag--${r()} cb-ds-tag--btn`}
          button={ROLE_NAME[r()]}
        >
          <RoleHelp />
        </PopButton>
      )}
    </Show>
  );
}

/** The ⓘ beside the Neural heading of the file list. */
export function RoleInfo(): JSX.Element {
  return (
    <PopButton
      label="Analysis data and reference data"
      title="Analysis data and reference data"
      width={380}
      class="cb-tip__btn"
      button={<HelpMark />}
    >
      <RoleHelp />
    </PopButton>
  );
}

/** What each reference file is used for, in one sentence. */
export const REFERENCE_USE: Partial<Record<SlotId, string>> = {
  neural_raw: "Not analyzed. Used to check the analysis data: each cell's signal to noise.",
  neural_denoised:
    "Not analyzed. Used to check the analysis data: the deconvolution check, and each cell's signal to noise when raw traces are not loaded.",
  neural_deconvolved:
    'Not analyzed. The deconvolution check compares these events with the traces.',
};

/** Make this file the analysis data. */
export function UseAsAnalysis(props: { slot: SlotId; link?: boolean }): JSX.Element {
  const kind = () => NEURAL_LAYERS.find((l) => l.slot === props.slot)?.kind;
  return (
    <Show when={kind()}>
      {(k) => (
        <button
          type="button"
          class={props.link ? 'cb-linkbtn' : 'btn-secondary btn-small'}
          onClick={() => setAnalysisData(k())}
        >
          Use as analysis data
        </button>
      )}
    </Show>
  );
}

/** Experiment config, Neural acquisition: which file the analyses read, and what each file gets. */
const qcText = (slot: SlotId) =>
  roleOf(slot) === 'analysis' ? 'Recommended' : qcShown(slot) ? 'On (optional)' : 'Off (optional)';
const prepText = (slot: SlotId) =>
  roleOf(slot) !== 'analysis'
    ? 'Not used'
    : sectionsFor(slot).includes('prep')
      ? 'Applies to every result'
      : 'No steps for this file';

export function AnalysisDataField(): JSX.Element {
  return (
    <Show
      when={loadedLayers().length}
      fallback={
        <div class="cb-setup-field">
          Analysis data
          <span class="cb-muted">Load a deconvolved, denoised or raw neural file.</span>
        </div>
      }
    >
      <label class="cb-setup-field">
        Analysis data
        <select
          value={analysisKind()}
          onChange={(e) => setAnalysisData(e.currentTarget.value as NeuralKind)}
        >
          <For each={loadedLayers()}>{(l) => <option value={l.kind}>{l.label}</option>}</For>
        </select>
      </label>
    </Show>
  );
}

/** What QC and Preprocess each loaded neural file gets. */
export function AnalysisDataTable(): JSX.Element {
  return (
    <Show when={loadedLayers().length}>
      <table class="cb-ds-cfg__wide cb-ds-roles">
        <thead>
          <tr>
            <th>File</th>
            <th>Role</th>
            <th>QC</th>
            <th>Preprocess</th>
          </tr>
        </thead>
        <tbody>
          <For each={loadedLayers()}>
            {(l) => (
              <tr>
                <td>{l.label}</td>
                <td>
                  <RoleTag slot={l.slot} />
                </td>
                <td>{qcText(l.slot)}</td>
                <td>{prepText(l.slot)}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </Show>
  );
}
