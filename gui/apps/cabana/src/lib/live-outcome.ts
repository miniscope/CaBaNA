// Whether a browser-engine run of an analysis is still in memory, so its interactive plots can be
// shown, and how to show it. The outcome is not saved with the run (only its tables are).

import { aurocOutcome, setAurocShowResults } from './auroc-run.ts';
import { browserRun } from './decoding-browser.ts';
import { pethOutcome, setPethShowResults } from './peth-run.ts';
import { placeOutcome, setPlaceShowResults } from './place-run.ts';
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

/** Switch an analysis page from its setup to the outcome in memory. Changes no setting. */
export function showBrowserOutcome(analysis: AnalysisId): void {
  if (analysis === 'place') setPlaceShowResults(true);
  if (analysis === 'auroc') setAurocShowResults(true);
  if (analysis === 'peth') setPethShowResults(true);
}
