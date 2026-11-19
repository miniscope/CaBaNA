// Whether the newest saved run of an analysis (of each Type) still matches the current settings.
// Shared by the cards' last-run line and the View results menu, so each analysis is compared once.
// Only the newest run of a Type is compared (an older one is "Older settings").

import { createEffect, createRoot, createSignal, type Accessor } from 'solid-js';
import { resultIndex } from './result-index.ts';
import { hasResults } from './results-overview.ts';
import { matchOfRecord, type Match } from './results-match.ts';
import type { AnalysisId } from './runs.ts';

type Matches = ReadonlyMap<string, Match | undefined>;
const cache = new Map<AnalysisId, Accessor<Matches>>();

/** The match of the newest full run and the newest Preview of `id`, by run id. */
export function newestMatches(id: AnalysisId): Accessor<Matches> {
  const found = cache.get(id);
  if (found) return found;
  const matches = createRoot(() => {
    const [value, setValue] = createSignal<Matches>(new Map());
    let seq = 0;
    createEffect(() => {
      const mine = ++seq;
      const mineOk = resultIndex().filter(
        (r) => r.analysis === id && r.status === 'ok' && hasResults(r),
      );
      // The index is newest first.
      const newest = (['full', 'preview'] as const).flatMap((scope) => {
        const r = mineOk.find((x) => x.scope === scope);
        return r ? [r] : [];
      });
      // Called inside the effect, so a changed setting reruns the comparison.
      const pending = newest.map((r) => matchOfRecord(r, true).catch(() => undefined));
      void Promise.all(pending).then((all) => {
        if (mine === seq) setValue(new Map(newest.map((r, i) => [r.run_id, all[i]])));
      });
    });
    return value;
  });
  cache.set(id, matches);
  return matches;
}
