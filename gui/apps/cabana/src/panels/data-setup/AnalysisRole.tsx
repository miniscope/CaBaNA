// Analysis data and Reference data: the tag each neural trace file carries, and the one
// explanation of what the two roles mean, opened from a tag, the Neural heading or a file's strip.

import { Show, type JSX } from 'solid-js';
import { analysisSlot, isReference } from '../../lib/analysis-data.ts';
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
