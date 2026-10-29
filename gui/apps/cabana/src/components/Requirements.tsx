import { For, Show, type JSX } from 'solid-js';
import { Unavailable } from '../panels/results/FrameworkNotice.tsx';
import { statusOfItem } from '../lib/readiness-snapshot.ts';
import { ITEM_LABEL, type AnalysisItem } from '../lib/readiness.ts';
import { goToStep } from '../lib/store.ts';
import { setAnalysisId } from '../lib/analyses.ts';

/** Sidebar item to open: setup steps by their id, analyses on the Analyze step. */
export function openItem(item: string): void {
  if (item === 'results' || ['load', 'setup', 'viz', 'qc', 'prep'].includes(item)) goToStep(item);
  else {
    setAnalysisId(item as AnalysisItem);
    goToStep('analyze');
  }
}

/**
 * Why an analysis cannot run, written on its page: what the user can supply (with a link to the
 * step that fixes it), a missing framework feature, or the Python engine not running. Shown at
 * the top of an analysis page; nothing renders when the analysis can run.
 */
export function Requirements(props: { analysis: AnalysisItem }): JSX.Element {
  const st = () => statusOfItem(props.analysis);
  const shown = () => ['needs_input', 'framework_update', 'outdated', 'failed'].includes(st().kind);
  return (
    <Show when={shown() && (st().input.length || st().framework.length || st().engineOff)}>
      <div class="cb-req" aria-label={`${ITEM_LABEL[props.analysis]} requirements`}>
        <Show when={st().input.length}>
          <div class="cb-un cb-req__input" role="status">
            <div class="cb-un__item">
              <strong>Needs input</strong>
              <For each={st().input}>
                {(n) => (
                  <p>
                    {n.text}{' '}
                    <Show when={n.link}>
                      {(l) => (
                        <button type="button" class="cb-link" onClick={() => openItem(l().item)}>
                          Open {l().label}
                        </button>
                      )}
                    </Show>
                  </p>
                )}
              </For>
            </div>
          </div>
        </Show>
        <Unavailable engineOff={st().engineOff} framework={st().framework} />
      </div>
    </Show>
  );
}
