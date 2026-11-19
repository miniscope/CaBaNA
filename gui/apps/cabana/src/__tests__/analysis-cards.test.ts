import { describe, expect, it } from 'vitest';
import { dataChips, lastRunLine, readinessLine } from '../lib/analysis-cards.ts';
import { badge } from '../lib/analyze-view.ts';
import type { Snapshot } from '../lib/readiness.ts';

const snap = (over: Partial<Snapshot> = {}): Snapshot =>
  ({
    deconvolved: true,
    position: true,
    spatialComplete: true,
    labels: { epochs: 0, behaviors: 2, zones: 0, alignable: 2 },
    populationStates: 2,
    decodingTarget: 'position',
    ...over,
  }) as Snapshot;

describe('analysis cards', () => {
  it('marks each data chip present or missing', () => {
    expect(dataChips(snap(), 'place').every((c) => c.have)).toBe(true);
    const chips = dataChips(snap({ position: false, spatialComplete: false }), 'place');
    expect(chips.map((c) => c.have)).toEqual([true, false, false]);
    expect(dataChips(snap({ analysisKind: 'raw' }), 'auroc')[0].have).toBe(false);
    expect(
      dataChips(snap({ labels: { epochs: 0, behaviors: 0, zones: 0, alignable: 0 } }), 'peth')[1],
    ).toEqual({
      label: 'Behavior annotations',
      have: false,
    });
  });

  it('asks decoding for position or behavior labels, by target', () => {
    expect(dataChips(snap(), 'decoding')[1].label).toBe('Position');
    expect(dataChips(snap({ decodingTarget: 'behaviors' }), 'decoding')[1]).toEqual({
      label: 'Behavior labels',
      have: true,
    });
  });

  it('words the readiness line', () => {
    expect(readinessLine(badge('ready'))).toEqual({ tone: 'ok', text: 'Ready to run' });
    expect(readinessLine(badge('complete')).tone).toBe('ok');
    expect(readinessLine({ ...badge('framework_update'), engineOff: true }).text).toBe(
      'Needs the Python engine',
    );
    const needs = { ...badge('needs_input'), input: [{ text: 'Load a position file.' }] };
    expect(readinessLine(needs)).toEqual({ tone: 'flag', text: 'Load a position file.' });
  });

  it('words the last-run line', () => {
    expect(lastRunLine(undefined, '')).toBe('No runs yet');
    expect(lastRunLine({ status: 'ok', scope: 'full' }, 'Nov 17, 9:01 PM')).toBe(
      'Last run Nov 17, 9:01 PM · saved',
    );
    expect(lastRunLine({ status: 'ok', scope: 'preview' }, 'x')).toBe(
      'Last run x · saved, Preview',
    );
    expect(lastRunLine({ status: 'failed', scope: 'full' }, 'x')).toBe('Last run x · failed');
  });
});
