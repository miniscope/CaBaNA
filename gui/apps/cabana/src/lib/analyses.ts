// The analyses offered on the Analyze step. `ready` ones can be run; the rest are listed as coming soon.

import { createSignal } from 'solid-js';

export const ANALYSES = [
  { id: 'place', label: 'Place cells', ready: true },
  { id: 'auroc', label: 'auROC', ready: true },
  { id: 'peth', label: 'PETH', ready: true },
  { id: 'decoding', label: 'Decoding', ready: true },
  { id: 'population', label: 'Population activity', ready: true },
] as const;

export type AnalysisId = (typeof ANALYSES)[number]['id'];

const [analysisId, setId] = createSignal<AnalysisId>('place');
/** Whether one analysis's own page (its views and results) is open instead of the card grid. */
export const [analysisPageOpen, setAnalysisPageOpen] = createSignal(false);

export { analysisId };
/** Open an analysis's own page. Every link that leads to an analysis or its result comes here. */
export function setAnalysisId(id: AnalysisId): void {
  setId(id);
  setAnalysisPageOpen(true);
}
