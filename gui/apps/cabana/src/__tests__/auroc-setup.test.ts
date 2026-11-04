import { describe, expect, it } from 'vitest';
import { pairUnavailable } from '../lib/auroc-view.ts';
import { aurocPlan, type AurocData } from '../lib/auroc-run.ts';
import {
  COMPARISON_TYPES,
  conditionGroups,
  frameClasses,
  frameSelection,
  frameSelectionText,
  groupCounts,
  isComparisonAvailable,
  referenceChoices,
  segments,
  ZONES_WAIT,
} from '../lib/auroc-setup.ts';

describe('auROC comparison choices', () => {
  it('says why another behavior is unavailable', () => {
    expect(pairUnavailable(['investigate_empty'])).toBe(
      'Needs two behaviors; this file has one: investigate_empty.',
    );
    expect(pairUnavailable([])).toMatch(/has none/);
    expect(pairUnavailable(['a', 'b'])).toBeUndefined();
  });
});

/** Ten frames: behavior a = frames 0-3, b = frames 2-5; frame 9 is excluded by frame selection. */
function toyData(): AurocData {
  const frames = 10;
  const row = (on: number[]) => Array.from({ length: frames }, (_, t) => (on.includes(t) ? 1 : 0));
  return {
    neural: new Float32Array(frames),
    cellIds: [0],
    cells: 1,
    frames,
    fs: 1,
    labels: ['a', 'b'],
    behaviors: Uint8Array.from([...row([0, 1, 2, 3]), ...row([2, 3, 4, 5])]),
    mask: Uint8Array.from(row([0, 1, 2, 3, 4, 5, 6, 7, 8])),
    excluded: { missingSpeed: 1, slow: 0, minSpeed: 2 },
    info: [
      { label: 'a', duration: 4, bouts: 1, during: 4, outside: 5 },
      { label: 'b', duration: 4, bouts: 1, during: 4, outside: 5 },
    ],
    cellsMissing: [],
  };
}
const rest = { compare: 'rest' as const, pairA: '', pairB: '', unselected: [] as string[] };
const pairAB = { ...rest, compare: 'behavior' as const, pairA: 'a', pairB: 'b' };

describe('auROC comparison types and reference groups', () => {
  it('offers only labeled conditions, and says why the others cannot run', () => {
    expect(isComparisonAvailable('labeled')).toBe(true);
    expect(isComparisonAvailable('windows')).toBe(false);
    expect(isComparisonAvailable('sessions')).toBe(false);
    expect(COMPARISON_TYPES.find((t) => t.id === 'windows')!.unavailable).toMatch(
      /trial-level null/,
    );
    expect(COMPARISON_TYPES.find((t) => t.id === 'sessions')!.unavailable).toMatch(/one session/);
  });

  it('gates the reference options', () => {
    expect(referenceChoices(['a', 'b']).map((c) => [c.id, !c.unavailable])).toEqual([
      ['rest', true],
      ['behavior', true],
      ['unlabeled', false],
    ]);
    expect(referenceChoices(['investigate_empty'])[1].unavailable).toMatch(
      /this file has one: investigate_empty/,
    );
  });

  it('enables only the behavior file as a condition source', () => {
    const g = conditionGroups(['a', 'b']);
    expect(g.map((x) => [x.id, x.disabled])).toEqual([
      ['behavior', undefined],
      ['zone-file', ZONES_WAIT],
      ['zone-drawn', ZONES_WAIT],
    ]);
    expect(g[0].conditions).toEqual(['a', 'b']);
  });
});

describe('auROC setup counts', () => {
  it('counts behavior and comparison frames against all other eligible frames', () => {
    const plan = aurocPlan(toyData(), rest);
    const [a, b] = groupCounts(plan, 9);
    expect(a).toMatchObject({ label: 'a', behavior: 4, comparison: 5, leftOut: 0, eligible: 9 });
    expect(b).toMatchObject({ label: 'b', behavior: 4, comparison: 5, leftOut: 0 });
  });

  it('leaves frames in neither or both behaviors out of a pairwise comparison', () => {
    const [c] = groupCounts(aurocPlan(toyData(), pairAB), 9);
    // a only: 0, 1. b only: 4, 5. Both: 2, 3. Neither: 6, 7, 8.
    expect(c).toMatchObject({ label: 'a vs b', behavior: 2, comparison: 2, leftOut: 5 });
  });

  it('reports the frame selection with the filter on and off', () => {
    const f = frameSelection(toyData());
    expect(f).toMatchObject({ total: 10, kept: 9, missingSpeed: 1, slow: 0 });
    expect(frameSelectionText(f)).toMatch(/1 frames with missing speed/);
    expect(frameSelectionText({ ...f, minSpeed: undefined })).toMatch(
      /every frame is kept, including frames with missing position/,
    );
  });
});

describe('auROC comparison timeline', () => {
  it('classes every frame and merges runs', () => {
    const data = toyData();
    const cls = frameClasses(data.mask, aurocPlan(data, pairAB).input, 0);
    expect(cls).toEqual([
      'behavior',
      'behavior',
      'leftOut',
      'leftOut',
      'comparison',
      'comparison',
      'leftOut',
      'leftOut',
      'leftOut',
      'excluded',
    ]);
    expect(segments(cls, 2)).toEqual([
      { cls: 'behavior', start: 0, stop: 1 },
      { cls: 'leftOut', start: 1, stop: 2 },
      { cls: 'comparison', start: 2, stop: 3 },
      { cls: 'leftOut', start: 3, stop: 4.5 },
      { cls: 'excluded', start: 4.5, stop: 5 },
    ]);
  });

  it('has no left-out frames against all other eligible frames', () => {
    const data = toyData();
    const cls = frameClasses(data.mask, aurocPlan(data, rest).input, 1);
    expect(cls.filter((c) => c === 'leftOut')).toHaveLength(0);
    expect(cls.filter((c) => c === 'behavior')).toHaveLength(4);
    expect(cls[9]).toBe('excluded');
  });
});
