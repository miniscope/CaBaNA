// The list of analyses on the Analysis page and the summary word the sidebar shows for it.
// Pure functions of the existing statuses; nothing here starts a run or changes a setting.

import { ANALYSES } from './analyses.ts';
import { rowReason } from './analyze-view.ts';
import type { AnalysisItem, Status } from './readiness.ts';

/** One line each, for the list; the longer text is in each analysis's own help. */
export const BRIEF: Record<AnalysisItem, string> = {
  place: 'spatial tuning',
  auroc: 'behavior selectivity',
  peth: 'neural data around onsets',
  decoding: 'position or behavior',
  population: 'ensemble structure',
};

export interface AnalysisListRow {
  id: AnalysisItem;
  label: string;
  brief: string;
  /** The status in words; "Needs rerun" is this list's word for outdated results. */
  status: string;
  kind: Status['kind'];
  /** Why it cannot run or what to do next, when there is something to say. */
  reason: string;
}

const statusWord = (s: Status) => (s.kind === 'outdated' ? 'Needs rerun' : s.text);

export function analysisListRows(statusOf: (id: AnalysisItem) => Status): AnalysisListRow[] {
  return ANALYSES.map((a) => {
    const s = statusOf(a.id);
    const reason = s.kind === 'ready' || s.kind === 'complete' ? '' : rowReason(s).text;
    return {
      id: a.id,
      label: a.label,
      brief: BRIEF[a.id],
      status: statusWord(s),
      kind: s.kind,
      reason,
    };
  });
}

/** The sidebar's word for the whole Analysis page: running first, then reruns, then what is ready. */
export function analysisSummary(statuses: Status[]): string {
  const n = (kind: Status['kind']) => statuses.filter((s) => s.kind === kind).length;
  if (n('running')) return 'Running';
  if (n('outdated')) return `${n('outdated')} need rerun`;
  const usable = n('ready') + n('complete');
  if (usable) return `${usable} of ${statuses.length} ready`;
  return 'Needs input';
}
