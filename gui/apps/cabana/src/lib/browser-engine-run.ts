// "Run in browser engine…" on the cards of Place cells, auROC and Decoding: the TypeScript port
// runs in this browser, with its own random draws. Always the user's explicit choice, never a
// fallback. Whether it may start, and the text the confirmation shows, are here.

import { aurocOutcome, aurocStatus, runAuroc } from './auroc-run.ts';
import { batchActive } from './analyze-batch.ts';
import { rowReason } from './analyze-view.ts';
import { browserBlock, runBrowserDecoding } from './decoding-browser.ts';
import { placeOutcome, placeStatus, runPlaceCells } from './place-run.ts';
import { statusOfItem } from './readiness-snapshot.ts';
import type { AnalysisItem } from './readiness.ts';
import { announceFinished, newestResultId } from './run-finished.ts';
import { active } from './runs.ts';

export const BROWSER_ENGINE_ANALYSES: readonly AnalysisItem[] = ['place', 'auroc', 'decoding'];
export const supportsBrowserEngine = (id: AnalysisItem) => BROWSER_ENGINE_ANALYSES.includes(id);

/** What the confirmation says before a run on the browser engine. */
export const BROWSER_ENGINE_NOTE =
  'The analysis runs in this browser (the TypeScript port of the framework methods, with GUI extensions) instead of the Python framework. Random draws differ, so p-values differ slightly from a framework run; observed values are the same. Results are labeled Browser engine.';

/** Why the browser engine cannot start now, or undefined when it can. */
export function browserEngineBlock(id: AnalysisItem): string | undefined {
  if (batchActive() || active()) return 'Another run is in progress.';
  const s = statusOfItem(id);
  if (s.kind === 'running') return 'Already running.';
  if (s.kind === 'needs_input') return rowReason(s).text;
  return id === 'decoding' ? browserBlock() || undefined : undefined;
}

/** Run on the browser engine and, when it finishes, open its Results window. */
export async function runOnBrowserEngine(id: AnalysisItem): Promise<void> {
  const before = newestResultId(id);
  let ok = false;
  if (id === 'place') {
    const was = placeOutcome();
    await runPlaceCells({ engine: 'browser' });
    ok = placeStatus().kind !== 'error' && placeOutcome() !== was;
  } else if (id === 'auroc') {
    const was = aurocOutcome();
    await runAuroc({ engine: 'browser' });
    ok = aurocStatus().kind !== 'error' && aurocOutcome() !== was;
  } else if (id === 'decoding') ok = await runBrowserDecoding();
  if (ok) void announceFinished(id, before);
}
