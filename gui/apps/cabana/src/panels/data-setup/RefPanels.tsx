// What the QC and Preprocess sections show for reference data. QC is off at first, with what it
// would check, when to turn it on, and the switch; turning it on only shows checks that already
// run. Preprocessing does not apply to reference data; its preview can still be opened.

import type { JSX } from 'solid-js';
import { createStore } from 'solid-js/store';
import { qcShown, setReferenceQc } from '../../lib/analysis-data.ts';
import type { SlotId } from '../../lib/slots.ts';
import { UseAsAnalysis } from './AnalysisRole.tsx';

/** What the QC of each reference file checks. */
const CHECKS: Partial<Record<SlotId, string>> = {
  neural_raw:
    "Each cell's signal to noise and events per cell, from the unfiltered fluorescence, and correlation with neighboring cells when footprints are loaded.",
  neural_denoised:
    "Each cell's signal to noise and number of events, from the denoised traces when raw traces are not loaded.",
  neural_deconvolved:
    'Whether the events, reconvolved with the kernel, explain the trace they were inferred from.',
};

/** The on/off switch for one reference file's QC. */
export function RefQcSwitch(props: { slot: SlotId }): JSX.Element {
  const on = () => qcShown(props.slot);
  return (
    <button
      type="button"
      role="switch"
      class="cb-prep-switch"
      aria-checked={on()}
      aria-label={`Run QC on this file: ${on() ? 'on' : 'off'}`}
      onClick={() => setReferenceQc(props.slot, !on())}
    >
      <span aria-hidden="true" />
      Run QC on this file
    </button>
  );
}

export function QcOffPanel(props: { slot: SlotId }): JSX.Element {
  return (
    <div class="cb-ds-off">
      <h4>QC is off for reference data</h4>
      <p>
        <b>It would check:</b> {CHECKS[props.slot]}
      </p>
      <p>
        <b>Turn it on when</b> you want to judge cell quality from this signal, for example to find
        noisy cells to reject.
      </p>
      <p>
        <b>Leave it off when</b> you only analyze the events, which have their own QC.
      </p>
      <p class="cb-muted">
        The choice is remembered for this file and dataset. Cell checks also appear in the analysis
        data's QC, whether or not this is on.
      </p>
      <div class="cb-controls">
        <RefQcSwitch slot={props.slot} />
        <UseAsAnalysis slot={props.slot} />
      </div>
    </div>
  );
}

const [previewing, setPreviewing] = createStore<Partial<Record<SlotId, boolean>>>({});
/** Whether a reference file's Preprocess section shows the preview the user asked for. */
export const previewAnyway = (slot: SlotId) => !!previewing[slot];
export const stopPreview = (slot: SlotId) => setPreviewing(slot, false);

export function PrepOffPanel(props: { slot: SlotId }): JSX.Element {
  return (
    <div class="cb-ds-off">
      <h4>Preprocessing isn't used for reference data</h4>
      <p>
        Preprocessing changes only what the analyses read, and they read the analysis data. To
        preprocess this file, make it the analysis data.
      </p>
      <p>
        <b>Usually you won't.</b> Most analyses use the deconvolved events; some use denoised
        traces; raw traces are rarely analyzed.
      </p>
      <div class="cb-controls">
        <UseAsAnalysis slot={props.slot} />
        <button
          type="button"
          class="btn-secondary btn-small"
          onClick={() => setPreviewing(props.slot, true)}
        >
          Preview smoothing anyway
        </button>
      </div>
    </div>
  );
}
