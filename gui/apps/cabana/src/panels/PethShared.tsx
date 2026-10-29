// What the PETH results views share: the selection state, labels, colors and reading notes.

import { Show, type JSX } from 'solid-js';
import type { Response } from '../lib/auroc.ts';
import { RESPONSE_LABEL } from '../lib/auroc-view.ts';
import type { PethOutcome } from '../lib/peth-run.ts';
import { pethData } from '../lib/peth-run.ts';
import { hasTest, type CellFilter, type CellSort } from '../lib/peth-view.ts';
import { behaviorColor } from './AurocPanel.tsx';
import { Resp } from './AurocResults.tsx';

/** Selection shared by the population view, the cell inspector and the summary. */
export interface Ctx {
  out: PethOutcome;
  /** Selected behavior (index into `out.labels`) and cell (index into `out.cellIds`). */
  b: number;
  c: number;
  setB: (b: number) => void;
  setC: (c: number) => void;
  sort: CellSort;
  setSort: (s: CellSort) => void;
  /** Which cells the heatmap and the cell list show (after the shuffle test). */
  filter: CellFilter;
  setFilter: (f: CellFilter) => void;
  /** Cells for the selected behavior in heatmap order. */
  order: number[];
  openInspector: () => void;
  backToPopulation: () => void;
}

/** One color per behavior, the same on the setup page and in every plot. */
export function colorOf(label: string): string {
  const d = pethData();
  // A column named "Behavior (offset)" has its behavior's color.
  const base = label.replace(/ \((onset|offset)\)$/, '');
  return behaviorColor('error' in d ? 0 : Math.max(0, d.labels.indexOf(d.labels.includes(label) ? label : base)));
}

/** A behavior's color as a small dot. */
export const Dot = (props: { label: string; muted?: boolean }): JSX.Element => (
  <span class="cb-dot" style={{ background: props.muted ? '#999' : colorOf(props.label) }} />
);

/** The label of one pair, or a note that there is none when the run had no shuffle test. */
export const Label = (props: { out: PethOutcome; r: Response | undefined }): JSX.Element => (
  <Show when={props.r} fallback={<span class="cb-muted">{hasTest(props.out) ? '' : 'No shuffle test'}</span>}>
    <Resp r={props.r!} />
  </Show>
);

export { RESPONSE_LABEL };

/** The sentence that goes wherever a Higher or Lower label appears. */
export const DIRECTION_NOTE = 'Higher and Lower describe the direction relative to the baseline interval, not a mechanism.';

/** What the labels mean, in the reading notes. */
export const LabelNote = (props: { out: PethOutcome }): JSX.Element => (
  <>
    <p>
      <Show
        when={hasTest(props.out)}
        fallback={<>This run had no shuffle test, so there are no p-values and no labels.</>}
      >
        A cell is <strong>Higher (excited)</strong> when the {props.out.settings.correction === 'max_stat' ? 'adjusted' : 'uncorrected'} p-value is below α ={' '}
        {props.out.settings.alpha} and response minus baseline is above 0, <strong>Lower (inhibited)</strong>{' '}
        when it is below α and the value is below 0, and <strong>Not significant</strong> otherwise.{' '}
        <strong>Not evaluated</strong> means the value is undefined: the behavior has too few onsets, or the
        cell has a non-finite neural value.
      </Show>
    </p>
    <p>{DIRECTION_NOTE}</p>
  </>
);

/** The aligned point in words, for notes that apply to every column of a run. */
export const alignWord = (o: PethOutcome) =>
  o.settings.align === 'both' ? 'the aligned point (bout onset or offset)' : `bout ${o.settings.align}`;

/** The latency explanation, collapsed. */
export const LatencyNote = (props: { out: PethOutcome }): JSX.Element => (
  <details class="cb-pe-latnote">
    <summary>How is latency estimated?</summary>
    <p>
      The gray band shows the 2.5th–97.5th percentile range of the mean response calculated from {props.out.settings.bandShifts}{' '}
      circularly shifted copies of the neural data. Latency is the center time of the first bin, at or after
      {alignWord(props.out)}, that starts a run of {props.out.settings.latencyBins} consecutive bins outside the band on the same
      side: all above it or all below it, so a switch from above to below starts a new run. The direction is reported with
      the latency. "Not detected" means no such run was found.
    </p>
    <p>
      This is a descriptive estimate, not a statistical test of response onset. The band is not corrected for testing
      multiple time bins or cells, and it uses its own shifts, not the shifts or the baseline comparison behind the
      significance test, so a cell can have a latency without being significant. Same-direction runs are a departure
      from the framework, which accepts any bins outside the band.
    </p>
  </details>
);

/** The interval and unit text the plots repeat. */
export const intervalText = (iv: [number, number]) => `${iv[0]} to ${iv[1]} s`;
