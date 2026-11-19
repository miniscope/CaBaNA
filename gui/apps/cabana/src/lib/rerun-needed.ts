// Which analyses have a newest saved result that no longer matches the current data and settings,
// for the Changes drawer. Uses the same comparison as the Results page (results-match.ts), so a
// framework run saved earlier counts too, not only the run of this window.

import { createEffect, createRoot, createSignal } from 'solid-js';
import { ANALYSES } from './analyses.ts';
import { resultIndex, runOutcome } from './result-index.ts';
import { matchOfRecord } from './results-match.ts';
import type { AnalysisId } from './runs.ts';

const [ids, setIds] = createSignal<AnalysisId[]>([]);

createRoot(() => {
  let seq = 0;
  createEffect(() => {
    resultIndex(); // rerun when saved results change
    const mine = ++seq;
    const newest = ANALYSES.map((a) => ({ id: a.id, r: runOutcome(a.id).result }));
    void Promise.all(
      newest.map(({ r }) => (r ? matchOfRecord(r, true).catch(() => undefined) : undefined)),
    ).then((found) => {
      if (mine === seq)
        setIds(newest.filter((_, i) => found[i] && !found[i]!.matches).map((n) => n.id));
    });
  });
});

/** Analyses whose newest saved result needs a rerun. */
export const analysesNeedingRerun = ids;
