// What each analysis card says: its data chips, the readiness line and the last-run line. Pure
// functions of the readiness snapshot, a status and a run record; nothing here starts a run.

import { rowReason } from './analyze-view.ts';
import type { AnalysisItem, Snapshot, Status } from './readiness.ts';

export interface DataChip {
  label: string;
  have: boolean;
}

/** The data an analysis reads, each marked present or missing, from the same snapshot as its status. */
export function dataChips(s: Snapshot, id: AnalysisItem): DataChip[] {
  const events: DataChip = {
    label: 'Deconvolved events',
    have: s.deconvolved && (!s.analysisKind || s.analysisKind === 'deconvolved'),
  };
  const behavior = (n: number): DataChip => ({ label: 'Behavior annotations', have: n >= 1 });
  switch (id) {
    case 'place':
      return [
        events,
        { label: 'Position', have: s.position },
        { label: 'Arena scale', have: s.position && s.spatialComplete },
      ];
    case 'auroc':
      return [events, behavior(s.labels.behaviors)];
    case 'peth':
      return [events, behavior(s.labels.alignable)];
    case 'decoding':
      return [
        events,
        s.decodingTarget === 'position'
          ? { label: 'Position', have: s.position && s.spatialComplete }
          : { label: 'Behavior labels', have: s.labels.behaviors >= 2 },
      ];
    case 'population':
      return [events, { label: 'Target with 2 states', have: s.populationStates >= 2 }];
  }
}

export interface ReadinessLine {
  tone: 'ok' | 'flag';
  text: string;
}

/** "Ready to run", or what is missing or out of date. Running is shown by the card's progress. */
export function readinessLine(s: Status): ReadinessLine {
  switch (s.kind) {
    case 'ready':
    case 'complete':
      return { tone: 'ok', text: 'Ready to run' };
    case 'framework_update':
      return {
        tone: 'flag',
        text: s.engineOff ? 'Needs the Python engine' : rowReason(s).text,
      };
    default:
      return { tone: 'flag', text: rowReason(s).text };
  }
}

/**
 * "Last run Nov 17, 9:01 PM · current", or "No runs yet". `when` is the formatted time and
 * `settings` the run's settings status in words ("current", "needs rerun", "older settings").
 */
export function lastRunLine(
  record: { status: string; scope: string } | undefined,
  when: string,
  settings = 'saved',
): string {
  if (!record) return 'No runs yet';
  const state =
    record.status === 'ok'
      ? record.scope === 'preview'
        ? `Preview · ${settings}`
        : settings
      : record.status === 'partial'
        ? 'partial result'
        : record.status;
  return `Last run ${when} · ${state}`;
}
