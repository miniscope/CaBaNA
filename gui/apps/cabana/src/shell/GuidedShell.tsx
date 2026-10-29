import { For, Show, type Component, type JSX } from 'solid-js';
import { DashboardShell, VizLayout } from '@calab/ui';
import { Header } from '../components/Header.tsx';
import { goToStep, stepId } from '../lib/store.ts';

export interface Step {
  id: string;
  label: string;
  /** Not built yet: shown in the stepper but greyed out. */
  soon?: boolean;
  panel?: Component;
}

/** Guided layout: one panel at a time with a stepper. A different shell can place the same panels differently. */
export function GuidedShell(props: { steps: Step[] }): JSX.Element {
  const i = () =>
    Math.max(
      0,
      props.steps.findIndex((s) => s.id === stepId()),
    );
  const setI = (n: number) => goToStep(props.steps[n].id);
  const step = () => props.steps[i()];
  const last = () => props.steps.findLastIndex((s) => !s.soon);
  return (
    <DashboardShell header={<Header />}>
      <VizLayout mode="scroll">
        <nav class="cb-steps" aria-label="Steps">
          <For each={props.steps}>
            {(s, n) => (
              <>
                <Show when={n() > 0}>
                  <span class="cb-step-line" classList={{ 'cb-step-line--done': n() <= i() }} />
                </Show>
                <button
                  class="cb-step"
                  classList={{
                    'cb-step--on': n() === i(),
                    'cb-step--done': n() < i(),
                    'cb-step--soon': !!s.soon,
                  }}
                  onClick={() => !s.soon && setI(n())}
                  title={s.soon ? 'Coming soon' : undefined}
                >
                  <span class="cb-step__n">{n() + 1}</span>
                  {s.label}
                </button>
              </>
            )}
          </For>
        </nav>
        <div class="cb-body">{step().panel?.({})}</div>
        <div class="cb-nav">
          <button class="btn-secondary" onClick={() => setI(Math.max(0, i() - 1))}>
            Back
          </button>
          <button class="btn-primary" onClick={() => setI(Math.min(last(), i() + 1))}>
            Next →
          </button>
        </div>
      </VizLayout>
    </DashboardShell>
  );
}
