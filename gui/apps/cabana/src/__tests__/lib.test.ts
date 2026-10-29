import { describe, expect, it } from 'vitest';
import { matchSlot } from '../lib/slots.ts';
import { positionQc } from '../lib/qc.ts';
import type { Table } from '../lib/parse.ts';

describe('matchSlot', () => {
  it('matches the example file names', () => {
    expect(matchSlot('neural_timestamps.csv')).toBe('neural_timestamps');
    expect(matchSlot('behavior_timestamps.csv')).toBe('behavior_timestamps');
    expect(matchSlot('zone_annotations.csv')).toBe('zone_annotations');
    expect(matchSlot('investigation_annotations.csv')).toBe('behavior_annotations');
    expect(matchSlot('neural_deconvolved.npy')).toBe('neural_deconvolved');
    expect(matchSlot('neural_deconvolved_filtered.npy')).toBeUndefined();
    expect(matchSlot('notes.txt')).toBeUndefined();
  });
});

const TOL = { lostPct: 5, jumpPct: 0.02 };

describe('positionQc', () => {
  const ts: Table = {
    columns: ['Frame Number', 'Time Stamp (ms)'],
    rows: Array.from({ length: 100 }, (_, i) => [String(i), String(i * 20)]),
  };
  const pos = (f: (i: number) => [number, number]): Table => ({
    columns: ['frame', 'x', 'y'],
    rows: Array.from({ length: 100 }, (_, i) => [String(i), ...f(i).map(String)]),
  });

  it('passes a smooth path', () => {
    const r = positionQc(
      pos((i) => [i * 0.1, 5]),
      ts,
      60,
      TOL,
    );
    expect(r.checks.every((c) => c.status === 'pass')).toBe(true);
  });

  it('flags lost frames and a teleport', () => {
    const r = positionQc(
      pos((i) => (i >= 10 && i < 30 ? [-1, -1] : i === 60 ? [50, 20] : [i * 0.1, 5])),
      ts,
      60,
      TOL,
    );
    const status = Object.fromEntries(r.checks.map((c) => [c.id, c.status]));
    expect(status.missing).toBe('fail');
    expect(status.jumps).toBe('fail');
  });
});
