// auROC setup: shared field layout, the method text, and the comparison type cards.
import { For, Show, type JSX } from 'solid-js';
import { MIN_FRAMES } from '../lib/auroc.ts';
import { COMPARISON_TYPES } from '../lib/auroc-setup.ts';
import { InfoTip } from './InfoTip.tsx';
import { AurocScale } from './AurocPanel.tsx';

/** What auROC measures and how it is tested, shown from the How it works button. */
export function AurocMethodText(): JSX.Element {
  return (
    <>
      <p>
        auROC measures how well a cell's deconvolved neural events separate two groups of frames: a
        behavior against a reference group. It is an effect size. Whether the separation is larger
        than chance comes from the significance test, not from the auROC value.
      </p>
      <p>
        <strong>Compare neural events:</strong> For each cell, auROC is the probability that a
        randomly chosen frame during the behavior has a higher neural value than a randomly chosen
        frame in the reference group. Against all other eligible frames, the reference group is
        every eligible frame outside the behavior, including unlabeled frames. Against another
        behavior, it is that behavior's frames only; frames in neither behavior, and frames in both,
        are left out. Frames removed by frame selection are left out of both groups.
      </p>
      <AurocScale />
      <p>
        <strong>Test significance:</strong> The cell's neural data are shifted in time relative to
        behavior (wrapping around the end of the recording) and auROC is recalculated. This gives
        the values expected without the original alignment. Neural data are autocorrelated, so
        frames are never shuffled one by one. The two-sided p-value compares the observed auROC with
        these values, then is adjusted for the number of behaviors tested per cell.
      </p>
      <p>
        <strong>Frames, not trials:</strong> Each frame is one data point, and neighboring frames
        are not independent. The result describes this recording only, and association is not
        causation.
      </p>
      <p>
        <strong>Not evaluated:</strong> auROC is left undefined when a cell has a missing neural
        value among the included frames, or when either group has fewer than {MIN_FRAMES} included
        frames. These results are not zero and not nonsignificant; they are left out of the counts
        of evaluated cells.
      </p>
    </>
  );
}

/** A setting's name, its control, and a short line on it, stacked in one column. */
export function Field(props: {
  title: string;
  tip?: JSX.Element;
  help?: JSX.Element;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div class="cb-au-field">
      <div class="cb-setting__title">
        {props.title}
        <Show when={props.tip}>
          <InfoTip label={`About ${props.title.toLowerCase()}`}>{props.tip}</InfoTip>
        </Show>
      </div>
      {props.children}
      <Show when={props.help}>
        <div class="cb-muted cb-au-field__help">{props.help}</div>
      </Show>
    </div>
  );
}

/** The comparison type stage: what auROC compares, and the type cards. */
export function AurocTypeSection(): JSX.Element {
  return (
    <>
      <p class="cb-muted">
        auROC separates two groups of frames. It is not a significance test: 0.5 means no
        separation, and the test in Significance testing says whether the separation is larger than
        chance. Each frame is one data point.
      </p>
      <div class="cb-au-types" role="group" aria-label="Comparison type">
        <For each={COMPARISON_TYPES}>
          {(t) => (
            <button
              type="button"
              class="cb-au-type"
              classList={{
                'cb-au-type--on': !t.unavailable,
                'cb-au-type--off': !!t.unavailable,
              }}
              aria-pressed={!t.unavailable}
              aria-disabled={!!t.unavailable}
            >
              <b>{t.title}</b>
              <span>{t.blurb}</span>
              <Show when={t.unavailable}>
                <span class="cb-badge cb-badge--warn">Not available yet</span>
                <span class="cb-muted">{t.unavailable}</span>
              </Show>
            </button>
          )}
        </For>
      </div>
    </>
  );
}
