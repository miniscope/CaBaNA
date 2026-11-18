import { Show, type JSX } from 'solid-js';
import { analysisId, analysisPageOpen, setAnalysisPageOpen } from '../lib/analyses.ts';
import { AnalysisCards } from './AnalysisCards.tsx';
import { AurocPanel } from './AurocPanel.tsx';
import { DecodingPanel } from './DecodingPanel.tsx';
import { PethPanel } from './PethPanel.tsx';
import { PlaceCellsPanel } from './PlaceCellsPanel.tsx';
import { PopulationPanel } from './PopulationPanel.tsx';

/** The results page of the analysis opened from Results or a link, with a way back to the cards. */
function AnalysisResults(): JSX.Element {
  return (
    <div class="cb-panel cb-panel--wide cb-anf">
      <div class="cb-anf__title">
        <button type="button" class="cb-link" onClick={() => setAnalysisPageOpen(false)}>
          ← Analysis
        </button>
      </div>
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
  );
}

/** Analysis: the cards of the five analyses, or the results of the one opened from a link. */
export function AnalyzePanel(): JSX.Element {
  return (
    <Show when={analysisPageOpen()} fallback={<AnalysisCards />}>
      <AnalysisResults />
    </Show>
  );
}
