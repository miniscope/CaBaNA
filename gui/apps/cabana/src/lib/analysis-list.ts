// The summary word the sidebar shows for the Analysis page.
// Pure functions of the existing statuses; nothing here starts a run or changes a setting.

import type { AnalysisItem, Status } from './readiness.ts';

/** One line each, for lists of the analyses; the longer text is in each analysis's own help. */
export const BRIEF: Record<AnalysisItem, string> = {
  place: 'spatial tuning',
  auroc: 'behavior selectivity',
  peth: 'neural data around onsets',
  decoding: 'position or behavior',
  population: 'ensemble structure',
};

/** The sidebar's word for the whole Analysis page: running first, then reruns, then what is ready. */
export function analysisSummary(statuses: Status[]): string {
  const n = (kind: Status['kind']) => statuses.filter((s) => s.kind === kind).length;
  if (n('running')) return 'Running';
  if (n('outdated')) return `${n('outdated')} need rerun`;
  const usable = n('ready') + n('complete');
  if (usable) return `${usable} of ${statuses.length} ready`;
  return 'Needs input';
}
