// Whether a saved run still matches the current settings and inputs, and why not. A framework run
// is compared by the hash of its settings. A browser-engine run can only be compared while its
// outcome is still in memory (the saved files do not hold the data it read), so only the newest
// run of an analysis ever is; any other browser run is simply "saved".

import type { RunRecord } from './bridge-client.ts';
import { bridgeReady } from './bridge-status.ts';
import { aurocChanges } from './auroc-view.ts';
import { browserOutcomeInMemory } from './live-outcome.ts';
import { pethChanges, pethSettingChanges } from './peth-view.ts';
import { placeChanges } from './place-ui.ts';
import { compareToRecord, type AnalysisId } from './runs.ts';

export interface Match {
  matches: boolean;
  /** What changed since the run, in words. */
  diff: string[];
}

/** What changed since the browser-engine outcome in memory, or undefined when none is kept. */
export function browserMatch(analysis: AnalysisId): Match | undefined {
  if (!browserOutcomeInMemory(analysis)) return undefined;
  const changes: Partial<Record<AnalysisId, () => string[]>> = {
    place: placeChanges,
    auroc: aurocChanges,
    peth: () => [...pethChanges(), ...pethSettingChanges()],
  };
  const read = changes[analysis];
  if (!read) return undefined;
  try {
    const diff = [...new Set(read())];
    return { matches: diff.length === 0, diff };
  } catch {
    return undefined; // state not complete yet (no data loaded)
  }
}

/** The match of one run. `newest` is whether it is the newest result of its analysis. */
export function matchOfRecord(r: RunRecord, newest: boolean): Promise<Match | undefined> {
  if (r.engine === 'framework')
    return bridgeReady()
      ? compareToRecord(r.analysis as AnalysisId, r)
      : Promise.resolve(undefined);
  return Promise.resolve(newest ? browserMatch(r.analysis as AnalysisId) : undefined);
}
