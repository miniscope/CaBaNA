// What the Analyze dashboard says: the wording of each row, which analyses can be checked, the
// recent-results list and the quick links. Pure functions of statuses and run records; nothing here
// starts a run or changes a setting.

import type { RunRecord } from './bridge-client.ts';
import {
  ITEM_LABEL,
  STATUS_TEXT,
  type AnalysisItem,
  type ItemId,
  type Need,
  type Status,
  type StatusKind,
} from './readiness.ts';
import { openness } from './results-overview.ts';

/** What each analysis does and what it needs, in one line each (from the help text of its page). */
export const ANALYSIS_INFO: Record<AnalysisItem, { does: string; needs: string }> = {
  place: {
    does: 'Finds cells whose neural signal varies with position and stays consistent over time.',
    needs: 'Neural data, a position file and the Spatial setup.',
  },
  auroc: {
    does: 'Finds cells with higher or lower neural events during each behavior.',
    needs: 'Neural data and at least one behavior label.',
  },
  peth: {
    does: 'Aligns neural data to the onsets or offsets of behavior bouts or time markers.',
    needs: 'Neural data and a behavior or time-marker label.',
  },
  decoding: {
    does: 'Predicts position or behavior from all cells together, on held-out blocks of time.',
    needs: 'Deconvolved events, and a position file or two behavior labels. Python engine.',
  },
  population: {
    does: 'Compares population patterns across behaviors, zones or positions.',
    needs: 'A target with at least 2 states. Python engine.',
  },
};

/** Kinds a batch may start: never run yet, results out of date, or the last run failed. */
const RUNNABLE: StatusKind[] = ['ready', 'outdated', 'failed'];

/**
 * Why this analysis cannot be started now, or undefined when it can. A complete analysis is only
 * started by its own Run button (`rerun`), never by Run selected.
 */
export function blockedReason(
  s: Status,
  reason: string,
  options: { rerun?: boolean; otherRunActive?: boolean } = {},
): string | undefined {
  if (s.kind === 'running') return 'Already running.';
  if (options.otherRunActive) return 'Another analysis is running. Wait for it to finish.';
  if (s.kind === 'complete') return options.rerun ? undefined : 'Results are up to date.';
  return RUNNABLE.includes(s.kind) ? undefined : reason;
}

/** The badge text of a row: "Needs update" is the dashboard's word for outdated results. */
export const dashboardStatus = (s: Status): Status =>
  s.kind === 'outdated' ? { ...s, text: 'Needs update' } : s;

export const badge = (kind: StatusKind, text = STATUS_TEXT[kind]): Status => ({
  kind,
  text,
  input: [],
  framework: [],
  engineOff: false,
});

/** The line under a row's name: what is wrong, or what to do next, with the page that fixes it. */
export function rowReason(s: Status): { text: string; link?: Need['link'] } {
  switch (s.kind) {
    case 'needs_input': {
      const more = s.input.length - 1;
      return {
        text: s.input[0].text + (more > 0 ? ` (+${more} more)` : ''),
        link: s.input.find((n) => n.link)?.link,
      };
    }
    case 'framework_update':
      if (s.engineOff) return { text: 'Start the Python engine to run this analysis.' };
      return {
        text: `${s.framework[0]?.text ?? 'A framework feature is missing.'} Needs a framework update.`,
      };
    case 'outdated':
      return { text: 'Settings or inputs changed since the last run. Run again to update.' };
    case 'failed':
      return { text: 'The last run failed. Open the page for details, then run again.' };
    case 'complete':
      return { text: 'Results are up to date.' };
    case 'ready':
      return { text: 'Ready to run.' };
    default:
      return { text: '' };
  }
}

// ---- recent results ---------------------------------------------------------------------------

export interface RecentResult {
  record: RunRecord;
  /** Shown as a badge. */
  status: Status;
  /** The record has a result that can be opened; otherwise the link goes to the analysis page. */
  openable: boolean;
}

const RESULT_BADGE: Record<RunRecord['status'], [StatusKind, string]> = {
  ok: ['complete', 'Complete'],
  partial: ['in_progress', 'Partial'],
  cancelled: ['not_started', 'Cancelled'],
  failed: ['failed', 'Failed'],
  queued: ['running', 'Queued'],
  running: ['running', 'Running'],
};

/** The newest records first, with the badge each shows. */
export function recentResults(records: RunRecord[], count = 5): RecentResult[] {
  return [...records]
    .sort((a, b) => b.created_utc.localeCompare(a.created_utc))
    .slice(0, count)
    .map((record) => {
      const [kind, text] = RESULT_BADGE[record.status] ?? ['not_started', record.status];
      return { record, status: badge(kind, text), openable: openness(record).kind !== 'blocked' };
    });
}

// ---- quick links ------------------------------------------------------------------------------

export interface QuickLink {
  item: ItemId;
  label: string;
  /** The analyses that are waiting on it. */
  forAnalyses: string[];
}

/** One link per page that fixes something an analysis needs (Results is added by the page). */
export function fixLinks(statuses: Partial<Record<AnalysisItem, Status>>): QuickLink[] {
  const links = new Map<ItemId, QuickLink>();
  for (const [id, s] of Object.entries(statuses) as [AnalysisItem, Status][]) {
    if (s.kind !== 'needs_input') continue;
    for (const need of s.input) {
      if (!need.link) continue;
      const link = links.get(need.link.item) ?? {
        item: need.link.item,
        label: need.link.label,
        forAnalyses: [],
      };
      if (!link.forAnalyses.includes(ITEM_LABEL[id])) link.forAnalyses.push(ITEM_LABEL[id]);
      links.set(need.link.item, link);
    }
  }
  return [...links.values()];
}
