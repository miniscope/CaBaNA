// Run selected, connected to the app: starts each analysis through its existing run function and
// reports how it ended. The batch lives here (not in the page) so it keeps going when the user
// opens another page. The rules for order, skipping and cancelling are in batch-run.ts.

import { createSignal } from 'solid-js';
import { aurocOutcome, aurocStatus, cancelAurocRun, runAuroc } from './auroc-run.ts';
import { pethOutcome, pethStatus, cancelPethRun, runPeth } from './peth-run.ts';
import { placeOutcome, placeStatus, cancelPlaceRun, runPlaceCells } from './place-run.ts';
import { ANALYSES } from './analyses.ts';
import { blockedReason, rowReason } from './analyze-view.ts';
import { runBatch, type RowState, type StepOutcome } from './batch-run.ts';
import type { RunRecord } from './bridge-client.ts';
import { statusOfItem } from './readiness-snapshot.ts';
import type { AnalysisItem } from './readiness.ts';
import { failureMessage } from './results-overview.ts';
import { active, cancelRun, lastError, runAnalysis } from './runs.ts';

/** The analyses in list order: the order a batch runs them. */
export const ANALYSIS_ORDER = ANALYSES.map((a) => a.id as AnalysisItem);

const [rowStates, setRowStates] = createSignal<Partial<Record<AnalysisItem, RowState>>>({});
const [batchActive, setBatchActive] = createSignal(false);
/** The state of each row from the latest batch (empty before the first). */
export { rowStates, batchActive };

let cancelRequested = false;

/** Forget the messages of a finished batch (kept while one is running). */
export function clearFinished(): void {
  if (!batchActive()) setRowStates({});
}

// Place cells and auROC take the Quick preview option on the framework engine; PETH and the
// framework-only analyses go through their own functions.
const frameworkOutcome = (rec: RunRecord | undefined): StepOutcome => {
  if (!rec) return { kind: 'failed', message: lastError()?.message ?? 'The run did not start.' };
  if (rec.status === 'cancelled') return { kind: 'cancelled' };
  if (rec.status === 'failed' || rec.status === 'partial')
    return { kind: 'failed', message: failureMessage(rec) };
  return { kind: 'ok' };
};

/**
 * Browser runs report errors through their status signal and a result through their outcome signal.
 * Neither a cancelled run nor a finished one sets an error, so a changed outcome tells them apart.
 */
function browserOutcome(status: { kind: string; message?: string }, changed: boolean): StepOutcome {
  if (status.kind === 'error')
    return { kind: 'failed', message: status.message ?? 'The run failed.' };
  return !changed && cancelRequested ? { kind: 'cancelled' } : { kind: 'ok' };
}

async function execute(id: AnalysisItem, preview: boolean): Promise<StepOutcome> {
  switch (id) {
    case 'place': {
      const before = placeOutcome();
      await runPlaceCells({ preview });
      return browserOutcome(placeStatus(), placeOutcome() !== before);
    }
    case 'auroc': {
      const before = aurocOutcome();
      await runAuroc({ preview });
      return browserOutcome(aurocStatus(), aurocOutcome() !== before);
    }
    case 'peth': {
      const before = pethOutcome();
      await runPeth();
      return browserOutcome(pethStatus(), pethOutcome() !== before);
    }
    default:
      return frameworkOutcome(await runAnalysis(id, preview ? 'preview' : 'full'));
  }
}

export interface StartOptions {
  /** Quick preview (50 shuffles, saved as Preliminary): framework engine only, PETH ignores it. */
  preview?: boolean;
  /** One analysis started by its own Run button: a complete one may run again. */
  rerun?: boolean;
}

/** Run the analyses one after another. Does nothing while a batch is already running. */
export async function startBatch(ids: AnalysisItem[], options: StartOptions = {}): Promise<void> {
  if (batchActive() || !ids.length) return;
  cancelRequested = false;
  setRowStates({});
  setBatchActive(true);
  try {
    await runBatch<AnalysisItem>({
      ids,
      blockedReason: (id) => {
        const s = statusOfItem(id);
        return blockedReason(s, rowReason(s).text, {
          rerun: options.rerun,
          otherRunActive: !!active(),
        });
      },
      execute: (id) => execute(id, !!options.preview),
      cancelRequested: () => cancelRequested,
      onState: (id, state) => setRowStates((all) => ({ ...all, [id]: state })),
    });
  } finally {
    setBatchActive(false);
  }
}

/** Stop the running analysis and skip the rest. */
export function cancelBatch(): void {
  cancelRequested = true;
  const running = ANALYSIS_ORDER.find((id) => rowStates()[id]?.kind === 'running');
  if (running === 'place') cancelPlaceRun();
  else if (running === 'auroc') cancelAurocRun();
  else if (running === 'peth') cancelPethRun();
  else void cancelRun();
}
