import { describe, expect, it } from 'vitest';
import {
  CANCELLED_REASON,
  queueOrder,
  runBatch,
  type RowState,
  type StepOutcome,
} from '../lib/batch-run.ts';

const ORDER = ['place', 'auroc', 'peth', 'decoding', 'population'];

function setup(over: {
  blocked?: Record<string, string>;
  outcomes?: Record<string, StepOutcome | Error>;
  cancelAfter?: string;
}) {
  const ran: string[] = [];
  const events: [string, string][] = [];
  let cancelled = false;
  const promise = runBatch({
    ids: ORDER,
    blockedReason: (id) => over.blocked?.[id],
    execute: async (id) => {
      ran.push(id);
      if (over.cancelAfter === id) cancelled = true;
      const o = over.outcomes?.[id] ?? { kind: 'ok' };
      if (o instanceof Error) throw o;
      return o as StepOutcome;
    },
    cancelRequested: () => cancelled,
    onState: (id, s: RowState) => events.push([id, s.kind]),
  });
  return { ran, events, promise };
}

describe('queueOrder', () => {
  it('follows the list order, not the order of checking', () => {
    expect(queueOrder(ORDER, new Set(['decoding', 'place', 'peth']))).toEqual([
      'place',
      'peth',
      'decoding',
    ]);
  });
  it('is empty when nothing is checked', () => {
    expect(queueOrder(ORDER, new Set())).toEqual([]);
  });
});

describe('runBatch', () => {
  it('runs one at a time in order and marks each done', async () => {
    const { ran, events, promise } = setup({});
    const final = await promise;
    expect(ran).toEqual(ORDER);
    expect([...final.values()].every((s) => s.kind === 'done')).toBe(true);
    // every row is waiting first, and a row starts only after the one before it finished
    expect(events.slice(0, 5).every(([, k]) => k === 'waiting')).toBe(true);
    expect(events.slice(5).map(([id, k]) => `${id}:${k}`)).toEqual(
      ORDER.flatMap((id) => [`${id}:running`, `${id}:done`]),
    );
  });

  it('skips an analysis that is not ready when its turn comes, and goes on', async () => {
    const { ran, promise } = setup({ blocked: { auroc: 'Load behavior annotations.' } });
    const final = await promise;
    expect(ran).toEqual(['place', 'peth', 'decoding', 'population']);
    expect(final.get('auroc')).toEqual({ kind: 'skipped', reason: 'Load behavior annotations.' });
  });

  it('a failure does not stop later analyses', async () => {
    const { ran, promise } = setup({
      outcomes: { peth: { kind: 'failed', message: 'No onsets.' } },
    });
    const final = await promise;
    expect(ran).toEqual(ORDER);
    expect(final.get('peth')).toEqual({ kind: 'failed', message: 'No onsets.' });
    expect(final.get('population')).toEqual({ kind: 'done' });
  });

  it('a thrown error counts as a failure', async () => {
    const { promise } = setup({ outcomes: { place: new Error('boom') } });
    expect((await promise).get('place')).toEqual({ kind: 'failed', message: 'boom' });
  });

  it('a cancelled step stops the batch and skips the rest', async () => {
    const { ran, promise } = setup({ outcomes: { peth: { kind: 'cancelled' } } });
    const final = await promise;
    expect(ran).toEqual(['place', 'auroc', 'peth']);
    expect(final.get('peth')).toEqual({ kind: 'cancelled' });
    expect(final.get('decoding')).toEqual({ kind: 'skipped', reason: CANCELLED_REASON });
    expect(final.get('population')).toEqual({ kind: 'skipped', reason: CANCELLED_REASON });
  });

  it('cancel pressed while a step finishes anyway still stops the later ones', async () => {
    const { ran, promise } = setup({ cancelAfter: 'auroc' });
    const final = await promise;
    expect(ran).toEqual(['place', 'auroc']);
    expect(final.get('auroc')).toEqual({ kind: 'done' });
    expect(final.get('peth')?.kind).toBe('skipped');
  });

  it('cancel also stops after a failed step', async () => {
    const { ran, promise } = setup({
      cancelAfter: 'place',
      outcomes: { place: { kind: 'failed', message: 'x' } },
    });
    await promise;
    expect(ran).toEqual(['place']);
  });
});
