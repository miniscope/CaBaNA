// The steps of a loaded file on the Data setup page: the numbered wizard under the file header, a
// one-line explanation of the open step with more in a fold, and Continue (and Skip) at the bottom.
// States come from lib/file-steps.ts; the step contents are unchanged.

import { createEffect, createSignal, For, Show, untrack, type JSX } from 'solid-js';
import { qcShown } from '../../lib/analysis-data.ts';
import {
  markSkipped,
  markVisited,
  openEntry,
  openSection,
  sectionOf,
  skipped,
  visited,
} from '../../lib/data-setup-view.ts';
import { SECTION_TITLE, sectionsFor, type SectionId } from '../../lib/file-sections.ts';
import { isOptional, STEP_TEXT, stepState, type StepState } from '../../lib/file-steps.ts';
import { SLOTS, type SlotId } from '../../lib/slots.ts';
import { scaleSet } from '../../lib/spatial-checks.ts';
import { spatialSnapshot } from '../../lib/spatial-state.ts';
import { loaded } from '../../lib/store.ts';
import { REFERENCE_USE, roleOf, UseAsAnalysis } from './AnalysisRole.tsx';
import { qcCounts } from './FileQc.tsx';
import { slotLabel } from './FileList.tsx';

const ICON: Partial<Record<StepState, string>> = { done: '✓', attention: '!' };

function facts(slot: SlotId, section: SectionId) {
  return stepState({
    section,
    visited: visited(slot, section),
    skipped: skipped(slot, section),
    role: roleOf(slot),
    qcShown: qcShown(slot),
    qc: section === 'qc' ? qcCounts(slot) : undefined,
    scaleSet: section === 'arena' && scaleSet(spatialSnapshot()),
  });
}

/** The numbered steps of a file; each one opens on click. */
export function StepWizard(props: { slot: SlotId }): JSX.Element {
  // The open step counts as visited.
  createEffect(() => {
    const slot = props.slot;
    const sec = sectionOf(slot);
    untrack(() => markVisited(slot, sec));
  });
  return (
    <ol class="cb-ds-wz" aria-label="Steps for this file">
      <For each={sectionsFor(props.slot)}>
        {(s, i) => {
          const f = () => facts(props.slot, s);
          const on = () => sectionOf(props.slot) === s;
          return (
            <li
              class={`cb-ds-wz__step cb-ds-wz--${f().state}`}
              classList={{ 'cb-ds-wz--on': on() }}
            >
              <button
                type="button"
                aria-current={on() ? 'step' : undefined}
                onClick={() => {
                  openSection(props.slot, s);
                  markVisited(props.slot, s, true);
                }}
              >
                <span class="cb-ds-wz__n" aria-hidden="true">
                  {(!on() && ICON[f().state]) || i() + 1}
                </span>
                <span class="cb-ds-wz__name">
                  {SECTION_TITLE[s]}
                  <Show when={isOptional({ section: s, role: roleOf(props.slot) })}>
                    <span class="cb-ds-wz__opt"> · optional</span>
                  </Show>
                </span>
                <span class="cb-ds-wz__short">{STEP_TEXT[s].short}</span>
                <span class="cb-ds-wz__state">{f().text}</span>
              </button>
            </li>
          );
        }}
      </For>
    </ol>
  );
}

/** Why the open step is off or not used, in place of its usual explanation. */
const offIntro = (slot: SlotId, s: SectionId): string | undefined => {
  if (roleOf(slot) !== 'reference') return undefined;
  if (s === 'prep')
    return 'Preprocessing applies only to the analysis data. This file is reference data, so nothing here changes any result.';
  if (s === 'qc' && !qcShown(slot))
    return 'QC is optional for reference data and is off. Turn it on to check this file anyway.';
  if (s === 'overview') return REFERENCE_USE[slot];
  return undefined;
};

/** One line on what the open step is for, with more in a fold; `right` sits at its end. */
export function StepIntro(props: { slot: SlotId; right?: JSX.Element }): JSX.Element {
  const [more, setMore] = createSignal(false);
  const s = () => sectionOf(props.slot);
  createEffect(() => (s(), setMore(false)));
  return (
    <>
      <div class="cb-ds-intro">
        <span class="cb-ds-intro__text">{offIntro(props.slot, s()) ?? STEP_TEXT[s()].intro}</span>
        <button
          type="button"
          class="cb-linkbtn"
          aria-expanded={more()}
          onClick={() => setMore(!more())}
        >
          {more() ? 'Less' : 'More about this step'}
        </button>
        <Show when={roleOf(props.slot) === 'reference' && s() === 'overview'}>
          <UseAsAnalysis slot={props.slot} link />
        </Show>
        <span class="cb-spacer" />
        {props.right}
      </div>
      <Show when={more()}>
        <p class="cb-ds-intro__more">{STEP_TEXT[s()].more}</p>
      </Show>
    </>
  );
}

const isLoaded = (id: SlotId) => !!loaded[id]?.summary && !!loaded[id]!.size;

/** Continue to the next step of this file, or else to the next loaded file; Skip on optional steps. */
export function StepFooter(props: { slot: SlotId }): JSX.Element {
  const list = () => sectionsFor(props.slot);
  const s = () => sectionOf(props.slot);
  const next = (): { label: string; go: () => void } | undefined => {
    const step = list()
      .slice(list().indexOf(s()) + 1)
      .find((x) => facts(props.slot, x).state !== 'unused');
    if (step) return { label: SECTION_TITLE[step], go: () => openSection(props.slot, step) };
    const after = SLOTS.slice(SLOTS.findIndex((x) => x.id === props.slot) + 1).find((x) =>
      isLoaded(x.id),
    );
    return after && { label: slotLabel(after), go: () => openEntry(after.id) };
  };
  return (
    <div class="cb-ds-foot">
      <Show when={list().length > 1}>
        <span class="cb-muted">
          Step {list().indexOf(s()) + 1} of {list().length}
        </span>
      </Show>
      <span class="cb-spacer" />
      <Show when={next()}>
        {(n) => (
          <>
            <Show when={isOptional({ section: s(), role: roleOf(props.slot) })}>
              <button
                type="button"
                class="btn-secondary btn-small"
                onClick={() => {
                  // Mark before going: the same component then shows the next file.
                  markSkipped(props.slot, s());
                  n().go();
                }}
              >
                Skip
              </button>
            </Show>
            <button
              type="button"
              class="btn-primary btn-small"
              onClick={() => {
                markVisited(props.slot, s(), true);
                n().go();
              }}
            >
              Continue to {n().label} →
            </button>
          </>
        )}
      </Show>
    </div>
  );
}
