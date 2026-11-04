// Run selected: the checked analyses one after another. This file only decides the order and what
// happens after each step; starting an analysis is passed in (see analyze-batch.ts), so the rules
// can be tested without the app.
//
// Decisions:
// - Order is the order of the analysis list, not the order the boxes were checked.
// - Readiness is checked again right before each step, since an earlier run can change it. An
//   analysis that cannot run then is skipped with its reason; the batch goes on.
// - A failed run does not stop the batch: the analyses are independent, so later ones still run.
// - Cancel stops the batch: the running analysis is cancelled and every later one is skipped.

export type StepOutcome =
  { kind: 'ok' } | { kind: 'failed'; message: string } | { kind: 'cancelled' };

export type RowState =
  | { kind: 'waiting' }
  | { kind: 'running' }
  | { kind: 'done' }
  | { kind: 'failed'; message: string }
  | { kind: 'cancelled' }
  | { kind: 'skipped'; reason: string };

export const CANCELLED_REASON = 'Not run: the batch was cancelled.';

/** The checked analyses in list order. */
export const queueOrder = <Id>(order: readonly Id[], checked: ReadonlySet<Id>): Id[] =>
  order.filter((id) => checked.has(id));

export interface BatchOptions<Id> {
  /** In run order. */
  ids: readonly Id[];
  /** Why this analysis cannot run now, or undefined when it can. */
  blockedReason: (id: Id) => string | undefined;
  /** Start one analysis and wait until it ends. */
  execute: (id: Id) => Promise<StepOutcome>;
  /** The user pressed Cancel. */
  cancelRequested: () => boolean;
  onState: (id: Id, state: RowState) => void;
}

/** Runs the batch; resolves with the final state of every row. */
export async function runBatch<Id>(opts: BatchOptions<Id>): Promise<Map<Id, RowState>> {
  const final = new Map<Id, RowState>();
  const set = (id: Id, state: RowState) => {
    final.set(id, state);
    opts.onState(id, state);
  };
  for (const id of opts.ids) set(id, { kind: 'waiting' });

  let stopped = false;
  for (const id of opts.ids) {
    if (stopped || opts.cancelRequested()) {
      stopped = true;
      set(id, { kind: 'skipped', reason: CANCELLED_REASON });
      continue;
    }
    const reason = opts.blockedReason(id);
    if (reason) {
      set(id, { kind: 'skipped', reason });
      continue;
    }
    set(id, { kind: 'running' });
    let outcome: StepOutcome;
    try {
      outcome = await opts.execute(id);
    } catch (e) {
      outcome = { kind: 'failed', message: e instanceof Error ? e.message : String(e) };
    }
    if (outcome.kind === 'cancelled') {
      stopped = true;
      set(id, { kind: 'cancelled' });
    } else if (outcome.kind === 'failed') set(id, { kind: 'failed', message: outcome.message });
    else set(id, { kind: 'done' });
  }
  return final;
}
