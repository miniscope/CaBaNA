import { For, Show, type JSX } from 'solid-js';
import { analysisId, setAnalysisId } from '../lib/analyses.ts';
import { analysisListRows } from '../lib/analysis-list.ts';
import { statusOfItem } from '../lib/readiness-snapshot.ts';
import { goToStep } from '../lib/store.ts';
import { AurocPanel } from './AurocPanel.tsx';
import { InfoTip } from './InfoTip.tsx';
import { PethPanel } from './PethPanel.tsx';
import { DecodingPanel } from './DecodingPanel.tsx';
import { PlaceCellsPanel } from './PlaceCellsPanel.tsx';
import { PopulationPanel } from './PopulationPanel.tsx';

/** The five analyses with a status word each; choosing one shows its page. */
function AnalysisList(): JSX.Element {
  const rows = () => analysisListRows(statusOfItem);
  return (
    <nav class="cb-anf__list" aria-label="Analyses">
      <div class="cb-anf__listhead">
        <span class="sc">Analyses</span>
        <button type="button" class="cb-link" onClick={() => goToStep('analyze_overview')}>
          All analyses
        </button>
      </div>
      <For each={rows()}>
        {(r) => (
          <button
            type="button"
            class="cb-anf__item"
            classList={{ 'cb-anf__item--on': analysisId() === r.id }}
            aria-current={analysisId() === r.id ? 'page' : undefined}
            title={r.reason || undefined}
            onClick={() => setAnalysisId(r.id)}
          >
            <span class="cb-anf__name">{r.label}</span>
            <span class="cb-anf__brief">{r.brief}</span>
            <span class="cb-anf__status" data-kind={r.kind}>
              {r.status}
            </span>
            <Show when={r.reason}>
              <span class="cb-anf__reason">{r.reason}</span>
            </Show>
          </button>
        )}
      </For>
    </nav>
  );
}

/** Analysis: the list of analyses, and the page of the one chosen. Each page brings its own title and views. */
export function AnalyzePanel(): JSX.Element {
  return (
    <div class="cb-panel cb-panel--wide cb-anf">
      <div class="cb-anf__title">
        <h2>Analysis</h2>
        <InfoTip label="About Analysis">
          Choose an analysis and set it up. Each run keeps its own settings, and the status words
          say whether it can run, needs input, or needs a rerun.
        </InfoTip>
      </div>
      <div class="cb-anf__grid">
        <AnalysisList />
        <div class="cb-anf__main">
          <Show when={analysisId() === 'place'}>
            <PlaceCellsPanel />
          </Show>
          <Show when={analysisId() === 'auroc'}>
            <AurocPanel />
          </Show>
          <Show when={analysisId() === 'peth'}>
            <PethPanel />
          </Show>
          <Show when={analysisId() === 'decoding'}>
            <DecodingPanel />
          </Show>
          <Show when={analysisId() === 'population'}>
            <PopulationPanel />
          </Show>
        </div>
      </div>
    </div>
  );
}
