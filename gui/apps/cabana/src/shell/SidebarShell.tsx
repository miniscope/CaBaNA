import { createSignal, For, Show, type JSX } from 'solid-js';
import { DashboardShell } from '@calab/ui';
import { Header } from '../components/Header.tsx';
import { ANALYSES, analysisId, setAnalysisId } from '../lib/analyses.ts';
import { goToStep, stepId } from '../lib/store.ts';
import type { Step } from './GuidedShell.tsx';

/** Steps that are not built yet. */
const AFTER = ['Results', 'Export'];

const FOLD_KEY = 'cabana-sidebar-folded';
const [folded, setFolded] = createSignal(
  (() => {
    try {
      return localStorage.getItem(FOLD_KEY) === '1';
    } catch {
      return false;
    }
  })(),
);
const toggleFold = () => {
  setFolded(!folded());
  try {
    localStorage.setItem(FOLD_KEY, folded() ? '1' : '0');
  } catch {
    // The choice just is not remembered.
  }
};
/** What a step button shows: its label, or its first letter when the sidebar is folded. */
const short = (label: string) => (folded() ? label.charAt(0) : label);

/** Sidebar layout: the same panels as the guided layout, with the steps listed on the left. */
export function SidebarShell(props: { steps: Step[] }): JSX.Element {
  const step = () => props.steps.find((s) => s.id === stepId()) ?? props.steps[0];
  return (
    <DashboardShell header={<Header />}>
      <div class="cb-app" classList={{ 'cb-app--folded': folded() }}>
        <nav class="cb-sidebar" aria-label="Steps">
          <button
            type="button"
            class="cb-ib cb-side__fold"
            aria-label={folded() ? 'Expand the sidebar' : 'Collapse the sidebar'}
            title={folded() ? 'Expand the sidebar' : 'Collapse the sidebar'}
            aria-expanded={!folded()}
            onClick={toggleFold}
          >
            {folded() ? '»' : '«'}
          </button>
          <For each={props.steps}>
            {(s) => (
              <>
                <button
                  class="cb-side"
                  classList={{ 'cb-side--on': s.id === stepId(), 'cb-side--soon': !!s.soon }}
                  title={folded() ? s.label : undefined}
                  aria-label={s.label}
                  onClick={() => !s.soon && goToStep(s.id)}
                >
                  {short(s.label)}
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
                        title={a.ready ? (folded() ? a.label : undefined) : 'Coming soon'}
                        aria-label={a.label}
                        onClick={() => {
                          if (!a.ready) return;
                          setAnalysisId(a.id);
                          goToStep('analyze');
                        }}
                      >
                        {short(a.label)}
                      </button>
                    )}
                  </For>
                </Show>
              </>
            )}
          </For>
          <For each={AFTER}>
            {(label) => (
              <div
                class="cb-side cb-side--soon"
                title={folded() ? `${label}: coming soon` : 'Coming soon'}
              >
                {short(label)}
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
