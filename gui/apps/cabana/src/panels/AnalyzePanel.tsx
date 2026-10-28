import { Show, type JSX } from 'solid-js';
import { analysisId } from '../lib/analyses.ts';
import { AurocPanel } from './AurocPanel.tsx';
import { PethPanel } from './PethPanel.tsx';
import { PlaceCellsPanel } from './PlaceCellsPanel.tsx';

/** The workspace of the analysis chosen in the sidebar. Each analysis brings its own title and views. */
export function AnalyzePanel(): JSX.Element {
  return (
    <div class="cb-panel cb-panel--wide">
      <Show when={analysisId() === 'place'}>
        <PlaceCellsPanel />
      </Show>
      <Show when={analysisId() === 'auroc'}>
        <AurocPanel />
      </Show>
      <Show when={analysisId() === 'peth'}>
        <PethPanel />
      </Show>
    </div>
  );
}
