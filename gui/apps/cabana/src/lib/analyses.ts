// The analyses offered on the Analyze step. `ready` ones can be run; the rest are listed as coming soon.

import { createSignal } from 'solid-js';

export const ANALYSES = [
  { id: 'place', label: 'Place cells', ready: true },
  { id: 'auroc', label: 'auROC', ready: true },
  { id: 'peth', label: 'PETH', ready: true },
  { id: 'decoding', label: 'Decoding', ready: true },
  { id: 'population', label: 'Population activity', ready: true },
] as const;

export const [analysisId, setAnalysisId] = createSignal<(typeof ANALYSES)[number]['id']>('place');
