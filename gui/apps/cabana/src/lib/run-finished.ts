// What happens when a full run finishes: its Results window opens over the page the user is on and
// a short toast says so. The caller passes the id of the analysis's newest result from before the
// run, to tell the new run from an older one.

import { analysisLabel } from './results-overview.ts';
import { runOutcome } from './result-index.ts';
import { openExplorer } from './results-nav.ts';
import { showToast } from './toast.ts';
import type { AnalysisId } from './runs.ts';

/** The id of the newest saved result of `id`, to pass to `announceFinished` before a run starts. */
export const newestResultId = (id: AnalysisId): string | undefined => runOutcome(id).result?.run_id;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Open the Results window on the run that just finished and say so. */
export async function announceFinished(id: AnalysisId, before: string | undefined): Promise<void> {
  // A browser-engine record is saved a moment after the run ends; wait briefly for it.
  let runId = newestResultId(id);
  for (let i = 0; i < 10 && runId === before; i++) {
    await wait(300);
    runId = newestResultId(id);
  }
  // Without a new record the window opens on the latest result, which the index then supplies.
  openExplorer(id, runId === before ? undefined : runId);
  const time = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  showToast(`${analysisLabel(id)} finished · ${time} · results opened`);
}
