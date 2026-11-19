// Which window of an analysis card is open: Configure settings, Preview, Previous results or Load
// configuration. Kept here so a results page can ask for the Configure window too.

import { createSignal } from 'solid-js';
import { setAnalysisPageOpen } from './analyses.ts';
import type { AnalysisItem } from './readiness.ts';

export type AnalysisWindowKind = 'configure' | 'preview' | 'previous' | 'load';

export const [analysisWindow, setAnalysisWindow] = createSignal<
  { id: AnalysisItem; kind: AnalysisWindowKind; before?: string } | undefined
>();

/**
 * Show the card grid with `kind` open over it (Previous results opens over the current page). `before` is the settings text Configure should go
 * back to on Discard, when something (Load configuration) changed the settings first.
 */
export function openAnalysisWindow(
  id: AnalysisItem,
  kind: AnalysisWindowKind,
  before?: string,
): void {
  // Previous results opens over whatever page asked for it; the others belong to the card grid.
  if (kind !== 'previous') setAnalysisPageOpen(false);
  setAnalysisWindow({ id, kind, before });
}
