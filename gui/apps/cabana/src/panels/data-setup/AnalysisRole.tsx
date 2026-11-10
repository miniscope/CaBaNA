// Analysis data and Reference data: the tag each neural trace file carries, and the one
// explanation of what the two roles mean, opened from a tag, the Neural heading or a file's strip.

import { Show, type JSX } from 'solid-js';
import {
  analysisSlot,
  isReference,
  NEURAL_LAYERS,
  qcShown,
  setAnalysisData,
} from '../../lib/analysis-data.ts';
import type { SlotId } from '../../lib/slots.ts';
import { PopButton } from '../QcParts.tsx';

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
        Experiment config → Neural acquisition. It is saved to config.yaml as{' '}
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
      button={<span aria-hidden="true">ⓘ</span>}
    >
      <RoleHelp />
    </PopButton>
  );
}

/** What each reference file is used for, in one sentence. */
const REFERENCE_USE: Partial<Record<SlotId, string>> = {
  neural_raw: "Not analyzed. Used to check the analysis data: each cell's signal to noise.",
  neural_denoised:
    "Not analyzed. Used to check the analysis data: the deconvolution check, and each cell's signal to noise when raw traces are not loaded.",
  neural_deconvolved:
    'Not analyzed. The deconvolution check compares these events with the traces.',
};

/** Under the stepper of a neural trace file: its role, what it is for, and the explanation. */
export function RoleStrip(props: { slot: SlotId }): JSX.Element {
  const text = (r: Role) =>
    r === 'analysis'
      ? 'The file every analysis reads. Its QC is recommended and its preprocessing applies to every result.'
      : REFERENCE_USE[props.slot];
  return (
    <Show when={roleOf(props.slot)}>
      {(r) => (
        <div class={`cb-ds-role cb-ds-role--${r()}`}>
          <span class={`cb-ds-tag cb-ds-tag--${r()}`}>{ROLE_NAME[r()]}</span>
          <span class="cb-ds-role__text" title={text(r())}>
            {text(r())}
          </span>
          <PopButton
            label="What does this mean?"
            title="Analysis data and reference data"
            width={380}
            class="cb-linkbtn"
            button="What does this mean?"
          >
            <RoleHelp />
          </PopButton>
          <Show when={r() === 'reference'}>
            <UseAsAnalysis slot={props.slot} link />
          </Show>
        </div>
      )}
    </Show>
  );
}

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

/** The small text after a section's name in a neural file's stepper, and whether it is off. */
export function stageNote(
  slot: SlotId,
  section: string,
): { text: string; off: boolean } | undefined {
  const r = roleOf(slot);
  if (!r || (section !== 'qc' && section !== 'prep')) return undefined;
  if (r === 'analysis') return { text: section === 'qc' ? 'recommended' : 'optional', off: false };
  if (section === 'prep') return { text: 'not used', off: true };
  return qcShown(slot)
    ? { text: 'on · optional', off: false }
    : { text: 'off · optional', off: true };
}
