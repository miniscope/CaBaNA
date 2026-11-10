// A file's Preprocess section on the Data setup page: only the steps that act on that file, with
// the same switches, settings and before/after preview as the old Preprocess page. The
// calculations (the framework ports in lib/framework.ts) are unchanged.

import { createEffect, For, Show, type JSX } from 'solid-js';
import { STEPS, type StepId } from '../../lib/prep-deps.ts';
import { STEP_HELP } from '../../lib/prep-help.ts';
import { helpTab, prepStep, setPrepStep, stepIssue } from '../../lib/prep-view.ts';
import type { SlotId } from '../../lib/slots.ts';
import { HelpDrawer, openHelp } from '../PrepHelp.tsx';
import { PrepPlots } from '../PrepPlots.tsx';
import {
  Field,
  FIELDS,
  Impact,
  OptionRow,
  OutOfDate,
  POSITION_VIEWS,
  PreviewBar,
  StandardRow,
  Summary,
} from '../PreprocessPanel.tsx';

/** The steps that act on each file: optional ones (with a switch), then automatic ones. */
const STEPS_OF: Partial<Record<SlotId, { optional: StepId[]; standard: StepId[] }>> = {
  position: { optional: ['fillGaps', 'posSmooth'], standard: ['positionOnFrames', 'speed'] },
  neural_deconvolved: { optional: ['eventSmooth'], standard: [] },
  neural_denoised: { optional: ['traceSmooth'], standard: [] },
  zone_annotations: { optional: ['boutPad'], standard: ['boutLabels'] },
  behavior_annotations: { optional: ['boutPad'], standard: ['boutLabels'] },
};

export function FilePrep(props: { slot: SlotId }): JSX.Element {
  const steps = () => STEPS_OF[props.slot] ?? { optional: [], standard: [] };
  const all = () => [...steps().optional, ...steps().standard];
  // Preview a step of this file; keep the one chosen last when it belongs here.
  createEffect(() => {
    if (all().length && !all().includes(prepStep())) setPrepStep(all()[0]);
  });
  const step = prepStep;
  return (
    <div class="cb-pp-body cb-ds-prep">
      <div class="cb-pp-settings">
        <section class="cb-pp-sec" aria-label="Optional steps">
          <For each={steps().optional}>{(s) => <OptionRow id={s} />}</For>
        </section>
        <Show when={steps().standard.length}>
          <section class="cb-pp-sec" aria-label="Standard preparation">
            <header class="cb-pp-sec__head">
              <h3>Standard</h3>
              <span class="cb-muted">Performed automatically as analyses need it.</span>
            </header>
            <For each={steps().standard}>{(s) => <StandardRow id={s} />}</For>
            <div class="cb-pp-row__set">
              <For each={steps().standard.flatMap((s) => FIELDS[s] ?? [])}>
                {(f) => <Field f={f} zeroOk={true} />}
              </For>
            </div>
          </section>
        </Show>
      </div>
      <main class="cb-prep__main cb-pp-preview">
        <Show when={all().includes(step())}>
          <Show when={all().length > 1}>
            <div class="cb-pp-tabs">
              <label class="cb-pp-view">
                Preview{' '}
                <select
                  value={step()}
                  onChange={(e) => setPrepStep(e.currentTarget.value as StepId)}
                >
                  <For each={all()}>{(s) => <option value={s}>{STEPS[s].label}</option>}</For>
                </select>
              </label>
              <span class="cb-muted">Previews update as settings change.</span>
            </div>
          </Show>
          <p class="cb-prep__used">
            {STEP_HELP[step()]?.short}{' '}
            <button
              class="cb-link"
              aria-haspopup="dialog"
              aria-expanded={helpTab() !== undefined}
              onClick={() => openHelp('about')}
            >
              About this step
            </button>
          </p>
          <PreviewBar step={step()} />
          <Show
            when={!stepIssue(step())}
            fallback={<div class="cb-empty cb-prep__empty">{stepIssue(step())}</div>}
          >
            <div class="cb-prep__plots">
              <PrepPlots step={step()} />
            </div>
          </Show>
          <div class="cb-prep__impact">
            <Show when={!stepIssue(step())}>
              <Show when={POSITION_VIEWS.includes(step())}>
                <Summary />
              </Show>
              <Impact step={step()} />
            </Show>
            <OutOfDate step={step()} />
          </div>
          <Show when={helpTab()}>
            <HelpDrawer step={step()} />
          </Show>
        </Show>
      </main>
    </div>
  );
}
