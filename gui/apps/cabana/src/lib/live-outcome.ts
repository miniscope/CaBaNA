// Whether a browser-engine run of an analysis is still in memory, so its interactive plots can be
// shown. The outcome is not saved with the run (only its tables are).

import { aurocOutcome } from './auroc-run.ts';
import { browserRun } from './decoding-browser.ts';
import { pethOutcome } from './peth-run.ts';
import { placeOutcome } from './place-run.ts';
import type { AnalysisId } from './runs.ts';

/** A browser-engine outcome of this analysis is in memory. */
export function browserOutcomeInMemory(analysis: AnalysisId): boolean {
  switch (analysis) {
    case 'place':
      return placeOutcome()?.engine === 'browser';
    case 'auroc':
      return aurocOutcome()?.engine === 'browser';
    case 'peth':
      return !!pethOutcome();
    case 'decoding':
      return !!browserRun();
    default:
      return false;
  }
}
