import { onMount, type JSX } from 'solid-js';
import { openAnalysisWindow } from '../lib/analysis-window.ts';
import type { AnalysisItem } from '../lib/readiness.ts';

/**
 * What an analysis's results page shows when it has no result to show: nothing of its own. The
 * cards page opens with that analysis's Configure settings window, where setup now lives.
 */
export function BackToCards(props: { id: AnalysisItem }): JSX.Element {
  onMount(() => openAnalysisWindow(props.id, 'configure'));
  return <></>;
}
