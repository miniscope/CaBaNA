// State of the Preview window: the shuffle count asked for and the preview run it started, per
// analysis. A preview runs through the same batch as the card's Run, as a Preview run saved with
// the other runs, and the window shows the newest one started from it.

import { createSignal } from 'solid-js';
import { startBatch, rowStates } from './analyze-batch.ts';
import type { RunRecord } from './bridge-client.ts';
import { PREVIEW_SHUFFLES } from './preview.ts';
import type { AnalysisItem } from './readiness.ts';
import { history, latest, type AnalysisId } from './runs.ts';

const [asked, setAsked] = createSignal<Partial<Record<AnalysisItem, number>>>({});
const [started, setStarted] = createSignal<Partial<Record<AnalysisItem, string>>>({});
// Whether a preview was tried from this window, so an old failure from a card is not shown here.
const [tried, setTried] = createSignal<Partial<Record<AnalysisItem, boolean>>>({});

/** The shuffle count in the window's field (default 50). */
export const askedShuffles = (id: AnalysisItem) => asked()[id] ?? PREVIEW_SHUFFLES;
export const askShuffles = (id: AnalysisItem, n: number) => setAsked((a) => ({ ...a, [id]: n }));

/** The preview run started from the window, if it has saved. */
export function previewRecord(id: AnalysisItem): RunRecord | undefined {
  const runId = started()[id];
  return runId ? history().find((r) => r.run_id === runId) : undefined;
}

/** Why the last preview run did not end in a result, if it did not. */
export function previewProblem(id: AnalysisItem): string | undefined {
  const s = tried()[id] ? rowStates()[id] : undefined;
  return s?.kind === 'failed' ? s.message : s?.kind === 'skipped' ? s.reason : undefined;
}

/** A window opens with no preview shown: the result appears after Run preview. */
export function forgetPreview(id: AnalysisItem): void {
  setStarted((s) => ({ ...s, [id]: undefined }));
  setTried((s) => ({ ...s, [id]: false }));
}

/** Newest preview run of `id` that is not in `known`. */
export function newPreview(records: RunRecord[], id: AnalysisId, known: Set<string>) {
  return records
    .filter((r) => r.analysis === id && r.scope === 'preview' && !known.has(r.run_id))
    .sort((a, b) => b.created_utc.localeCompare(a.created_utc))[0];
}

/** Run a preview with `shuffles` and show its result when it saves. */
export async function runPreview(id: AnalysisItem, shuffles: number): Promise<void> {
  setTried((s) => ({ ...s, [id]: true }));
  const known = new Set(history().map((r) => r.run_id));
  await startBatch([id], { preview: true, shuffles, rerun: true });
  const made = newPreview([latest[id as AnalysisId], ...history()].filter((r): r is RunRecord => !!r), id, known);
  if (made?.status === 'ok') setStarted((s) => ({ ...s, [id]: made.run_id }));
}
