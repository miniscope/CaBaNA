import { For, Show, type JSX } from 'solid-js';
import { DashboardShell } from '@calab/ui';
import { Header } from '../components/Header.tsx';
import { ANALYSES, analysisId, setAnalysisId } from '../lib/analyses.ts';
import { goToStep, stepId } from '../lib/store.ts';
import type { Step } from './GuidedShell.tsx';

/** Steps that are not built yet. */
const AFTER = ['Results', 'Export'];

/** Sidebar layout: the same panels as the guided layout, with the steps listed on the left. */
export function SidebarShell(props: { steps: Step[] }): JSX.Element {
  const step = () => props.steps.find((s) => s.id === stepId()) ?? props.steps[0];
  return (
    <DashboardShell header={<Header />}>
      <div class="cb-app">
        <nav class="cb-sidebar" aria-label="Steps">
          <For each={props.steps}>
            {(s) => (
              <>
                <button
                  class="cb-side"
                  classList={{ 'cb-side--on': s.id === stepId(), 'cb-side--soon': !!s.soon }}
                  onClick={() => !s.soon && goToStep(s.id)}
                >
                  {s.label}
                </button>
                <Show when={s.id === 'analyze'}>
                  <For each={ANALYSES}>
                    {(a) => (
                      <button
                        class="cb-side cb-side--sub"
                        classList={{
                          'cb-side--on': stepId() === 'analyze' && analysisId() === a.id,
                          'cb-side--soon': !a.ready,
                        }}
                        title={a.ready ? undefined : 'Coming soon'}
                        onClick={() => {
                          if (!a.ready) return;
                          setAnalysisId(a.id);
                          goToStep('analyze');
                        }}
                      >
                        {a.label}
                      </button>
                    )}
                  </For>
                </Show>
              </>
            )}
          </For>
          <For each={AFTER}>
            {(label) => (
              <div class="cb-side cb-side--soon" title="Coming soon">
                {label}
              </div>
            )}
          </For>
        </nav>
        <div class="cb-side-main">
          <div class="cb-body">{step().panel?.({})}</div>
        </div>
      </div>
    </DashboardShell>
  );
}
