import { describe, expect, it } from 'vitest';
import {
  loadBehaviorDecoding,
  loadPositionDecoding,
  type BehaviorDecodingView,
} from '../lib/decoding-results.ts';
import { foldBoundaries } from '../lib/fold-strip.ts';
import {
  choiceGates,
  frameCounts,
  frameworkItems,
  localChecks,
  settingProblems,
  stripBlocks,
  type InputFacts,
} from '../panels/decoding/logic.ts';
import {
  behaviorCsv,
  behaviorRows,
  behaviorStats,
  binCells,
  confusionMatrix,
  errorHistogram,
  oneVsRestTables,
  positionCsv,
  positionStats,
} from '../panels/decoding/model.ts';
import { openFixture } from './fixture-source.ts';

const none = () => false;
const facts = (o: Partial<InputFacts> = {}): InputFacts => ({
  neuralLoaded: true,
  deconvolved: true,
  positionLoaded: true,
  arenaOutline: true,
  usableBehaviors: ['a', 'b'],
  selected: ['a', 'b'],
  minFramesPerClass: 20,
  ...o,
});

describe('validation reasons', () => {
  it('lists what the user can fix', () => {
    expect(localChecks('position', facts())).toEqual([]);
    expect(localChecks('position', facts({ positionLoaded: false, arenaOutline: false }))).toEqual([
      'Load a position file.',
      'Draw the arena outline in Experimental setup (Spatial).',
    ]);
    expect(localChecks('position', facts({ deconvolved: false }))[0]).toMatch(
      /not deconvolved events/,
    );
    expect(localChecks('position', facts({ neuralLoaded: false, deconvolved: false }))).toContain(
      'Load neural data.',
    );
    expect(localChecks('behaviors', facts({ usableBehaviors: ['a'], selected: ['a'] }))[0]).toMatch(
      /at least 2 usable/,
    );
    expect(localChecks('behaviors', facts({ selected: ['a'] }))[0]).toMatch(/Select at least 2/);
  });
  it('needs one behavior with enough frames', () => {
    const usable = { perClass: { a: 5, b: 19 }, overlapFrames: 0, noneFrames: 0, totalFrames: 100 };
    expect(localChecks('behaviors', facts({ usable }))[0]).toMatch(/No behavior has 20 frames/);
    const ok = { ...usable, perClass: { a: 5, b: 20 } };
    expect(localChecks('behaviors', facts({ usable: ok }))).toEqual([]);
  });
  it('flags settings outside their range', () => {
    const s = {
      folds: 5,
      foldGapS: 1,
      shuffles: 1000,
      blockS: 1,
      alpha: 0.05,
      windowS: 0.25,
      smoothSigmaBins: 0,
      minFramesPerClass: 20,
    };
    expect(settingProblems(s, false)).toEqual([]);
    expect(settingProblems({ ...s, folds: 1, alpha: 1, blockS: 0 }, false)).toHaveLength(3);
    expect(settingProblems({ ...s, C: 0, binS: 0.5 }, true)).toEqual(['C: more than 0.']);
  });
});

describe('framework requirements and greyed choices', () => {
  it('names each missing feature in plain words, with the contract code only in details', () => {
    const items = frameworkItems(['decoding_fold_gap', 'overlap_policy'], none);
    expect(items).toHaveLength(2);
    for (const i of items) expect(i.text + i.short).not.toMatch(/\bF\d\b/);
    expect(items[0].code).toMatch(/F1/);
    expect(frameworkItems(['decoding_fold_gap'], () => true)).toEqual([]);
  });
  it('greys fold gap, exclude overlap and multiclass until the framework has them', () => {
    const g = choiceGates(none);
    expect([g.foldGap.disabled, g.overlapExclude.disabled, g.multiclass.disabled]).toEqual([
      true,
      true,
      true,
    ]);
    expect(g.overlapExclude.reason).toMatch(/overlap/);
    const open = choiceGates(() => true);
    expect([open.foldGap.disabled, open.overlapExclude.disabled, open.multiclass.disabled]).toEqual(
      [false, false, false],
    );
  });
});

describe('frame counts under the overlap policy', () => {
  const times = Array.from({ length: 10 }, (_, i) => i); // 1 Hz, frames 0..9
  const bouts = [
    { label: 'a', start: 0, stop: 5 }, // frames 0-4
    { label: 'b', start: 3, stop: 7 }, // frames 3-6, overlaps a on 3-4
  ];
  it('excludes overlapping frames', () => {
    const c = frameCounts(bouts, times, ['a', 'b'], 'exclude', true);
    expect(c.perClass.a).toBe(3);
    expect(c.perClass.b).toBe(2);
    expect(c.overlapFrames).toBe(2);
    expect(c.noneFrames).toBe(3);
    expect(c.perClass['Other / none of the selected behaviors']).toBe(3);
  });
  it('gives overlapping frames to the first behavior in the priority list', () => {
    expect(frameCounts(bouts, times, ['a', 'b'], 'priority', false).perClass).toEqual({
      a: 5,
      b: 2,
    });
    expect(frameCounts(bouts, times, ['b', 'a'], 'priority', false).perClass).toEqual({
      a: 3,
      b: 4,
    });
  });
});

describe('fold strip layout inputs', () => {
  it('covers the session with k contiguous blocks and clips the gaps at the ends', () => {
    const n = 18000;
    const fs = 30;
    const blocks = stripBlocks(n, 5, fs, 1);
    expect(blocks).toHaveLength(5);
    expect(blocks[0].x0).toBe(0);
    expect(blocks[4].x1).toBe(1);
    blocks.slice(1).forEach((b, i) => expect(b.x0).toBe(blocks[i].x1));
    expect(blocks[0].gapBefore[0]).toBe(0);
    expect(blocks[4].gapAfter[1]).toBe(1);
    expect(blocks[1].gapBefore[1] - blocks[1].gapBefore[0]).toBeCloseTo(1 / 600); // 1 s of 600 s
    const b = foldBoundaries(n, 5);
    expect(blocks[2].x0).toBeCloseTo(b[2] / n);
  });
});

describe('position result views (every number equals the array)', () => {
  const [d, src] = openFixture('bayes_position_open_field');
  const a = d.arrays.decoding_position;
  it('summary cards read the framework values and never show a p-value for the overall value', async () => {
    const v = (await loadPositionDecoding(src, d.manifest))!;
    const [overall, chance, frames, evaluated] = positionStats(v);
    expect(overall.value).toBe(String(+Number(a.extra_3.data[0]).toFixed(2)));
    expect(overall.note).toMatch(/not tested.*per-bin tests are unaffected/);
    expect(chance.value).toBe(String(+Number(a.extra_5.data[0]).toFixed(2)));
    expect(frames.value).toBe(
      Array.from(a.extra_2.data)
        .filter((x) => x != null && Number.isFinite(x))
        .length.toLocaleString(),
    );
    expect(evaluated.value).toBe(
      `${Array.from(a.values.data).filter((x) => x != null).length} of 169`,
    );
    expect(JSON.stringify([overall, chance])).not.toMatch(/\bp\b/);
  });
  it('places each bin on the 13 x 13 grid with its own error, p-value and flags', async () => {
    const v = (await loadPositionDecoding(src, d.manifest))!;
    const cells = binCells(v)!;
    expect(cells).toHaveLength(169);
    cells.forEach((c, i) => {
      expect(c.col * 13 + c.row).toBe(i);
      expect(c.error).toBe(a.values.data[i]);
      expect(c.p).toBe(a.sh_p_value.data[i]);
      expect(c.significantAdj).toBe(Number(a.sh_significant_adj.data[i]) === 1);
      expect(c.excluded).toBe(a.values.data[i] == null);
    });
  });
  it('groups the per-frame errors without losing or inventing a frame', async () => {
    const v = (await loadPositionDecoding(src, d.manifest))!;
    const h = errorHistogram(v.frameError!.data, 30)!;
    const finite = Array.from(a.extra_2.data).filter((x) => x != null && Number.isFinite(x));
    expect(h.counts.reduce((s, n) => s + n, 0)).toBe(finite.length);
    expect(h.edges[0]).toBe(Math.min(...(finite as number[])));
  });
  it('writes one CSV row per bin with the notes', async () => {
    const v = (await loadPositionDecoding(src, d.manifest))!;
    const text = positionCsv(v, { scope: 'preview', analysis: 'decoding', run_id: 'r1' });
    const lines = text.trim().split('\n');
    expect(lines.filter((l) => l.startsWith('#')).join(' ')).toMatch(/Preliminary.*not tested/s);
    const body = lines.filter((l) => !l.startsWith('#'));
    expect(body).toHaveLength(170);
    expect(body[1].split(',')[5]).toBe(String(a.sh_p_value.data[0]));
  });
});

describe('behavior result views', () => {
  const [d, src] = openFixture('decode_logistic_social');
  const a = d.arrays.decoding_behavior;
  it('rows carry score, null range and both p-values from the arrays', async () => {
    const v = (await loadBehaviorDecoding(src, d.manifest))!;
    const rows = behaviorRows(v);
    expect(rows.map((r) => r.name)).toEqual(['follow', 'sniff_anogenital', 'sniff_face']);
    rows.forEach((r, i) => {
      expect(r.score).toBe(a.values.data[i]);
      expect(r.nullLo).toBe(a.sh_null_lo.data[i]);
      expect(r.nullHi).toBe(a.sh_null_hi.data[i]);
      expect(r.p).toBe(a.sh_p_value.data[i]);
      expect(r.pAdj).toBeNull(); // this fixture ran without correction
      expect(r.significant).toBe(Number(a.sh_significant.data[i]) === 1);
    });
    expect(behaviorStats(v)[0].note).toMatch(/not tested/);
  });
  it('splits the confusion array into one table per behavior', async () => {
    const v = (await loadBehaviorDecoding(src, d.manifest))!;
    const t = oneVsRestTables(v);
    expect(t[1]).toMatchObject({
      behavior: 'sniff_anogenital',
      tn: a.extra_0.data[4],
      fp: a.extra_0.data[5],
      fn: a.extra_0.data[6],
      tp: a.extra_0.data[7],
    });
    expect(confusionMatrix(v, true)).toBeUndefined();
  });
  it('uses the framework row shares when normalizing a Bayesian matrix', () => {
    const shares = [
      [0.5, 0.5],
      [0.2, 0.8],
    ];
    const v = {
      confusionKind: 'matrix',
      confusion: { shape: [2, 2], data: [5, 5, 2, 8] },
      rowShares: () => shares,
    } as unknown as BehaviorDecodingView;
    expect(confusionMatrix(v, true)).toBe(shares);
    expect(confusionMatrix(v, false)).toEqual([
      [5, 5],
      [2, 8],
    ]);
  });
  it('writes the behavior CSV with corrected and uncorrected p-values', async () => {
    const v = (await loadBehaviorDecoding(src, d.manifest))!;
    const lines = behaviorCsv(v, { scope: 'full', analysis: 'decoding', run_id: 'r2' })
      .trim()
      .split('\n');
    const header = lines.find((l) => l.startsWith('behavior,'))!;
    expect(header).toBe('behavior,score,null_low,null_high,p_uncorrected,p_corrected,significant');
    expect(lines.filter((l) => !l.startsWith('#'))).toHaveLength(4);
  });
});
