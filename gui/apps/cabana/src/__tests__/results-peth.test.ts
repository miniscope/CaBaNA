import { describe, expect, it } from 'vitest';
import { parseSavedCsv } from '../lib/results-explorer.ts';
import {
  heatColor,
  heatLimit,
  pethCounts,
  pethMeanSpec,
  pethModel,
  populationMean,
  significantCells,
  sortCells,
} from '../lib/results-peth.ts';
import type { RunRecord } from '../lib/bridge-client.ts';

// Three cells, one behavior, three bins. Cell 3 has no value (not evaluated).
const pairs = parseSavedCsv(
  'peth.csv',
  [
    '# note',
    'cell,behavior,alignment,onsets,value_au,p_unadjusted,p_adjusted,response,latency_s,latency_direction,wilcoxon_p',
    '1,"hug",onset,10,0.1,0.01,0.02,Excited,0.5,above,',
    '2,"hug",onset,10,-0.3,0.01,0.02,Inhibited,,,',
    '3,"hug",onset,10,,,,Not evaluated,,,',
    '4,"hug",onset,10,0.02,0.5,0.9,Not significant,,,',
  ].join('\n'),
);
const row = (c: number, v: number[]) => v.map((m, i) => `${c},"hug",${i - 1},${m},0,,`).join('\n');
const curves = parseSavedCsv(
  'peth_curves.csv',
  [
    '# mean over onsets, each onset minus its own baseline mean',
    'cell,behavior,time_s,mean,sem,null_lo,null_hi',
    row(1, [0, 0.1, 0.2]),
    row(2, [0, -0.3, -0.2]),
    row(3, [NaN, NaN, NaN]).replace(/NaN/g, ''),
    row(4, [0, 0.02, 0]),
  ].join('\n'),
);
const metadata = { window: { baseline_s: [-1, 0], response_s: [0, 1] } };

describe('PETH model from saved tables', () => {
  const m = pethModel(pairs, curves, metadata)!;
  it('reads the behaviors, time axis and window', () => {
    expect(m.behaviors.map((b) => b.label)).toEqual(['hug']);
    expect(m.timeS).toEqual([-1, 0, 1]);
    expect(m.baselineS).toEqual([-1, 0]);
    expect(m.baselineSubtracted).toBe(true);
    expect(m.hasTest).toBe(true);
  });
  it('orders cells by response, cells without a value last', () => {
    expect(m.behaviors[0].cells.map((c) => c.cell)).toEqual([1, 4, 2, 3]);
  });
  it('counts the saved labels', () => {
    expect(pethCounts(m)).toEqual({
      excited: 1,
      inhibited: 1,
      notSignificant: 1,
      evaluated: 3,
      notEvaluated: 1,
    });
    expect(significantCells(m.behaviors[0]).map((c) => c.cell)).toEqual([1, 2]);
  });
  it('averages only cells with a value', () => {
    const mean = populationMean(m.behaviors[0]);
    expect(mean[1]).toBeCloseTo((0.1 - 0.3 + 0.02) / 3);
  });
  it('sorts by a column with blank values last', () => {
    const cells = m.behaviors[0].cells;
    expect(sortCells(cells, 'value', true).map((c) => c.cell)).toEqual([1, 4, 2, 3]);
    expect(sortCells(cells, 'latency', false).map((c) => c.cell)).toEqual([1, 4, 2, 3]);
    expect(sortCells(cells, 'cell', true).map((c) => c.cell)).toEqual([4, 3, 2, 1]);
  });
  it('returns nothing for other tables', () => {
    expect(pethModel(curves, pairs)).toBeUndefined();
    expect(pethModel(undefined, curves)).toBeUndefined();
  });
});

describe('heat colors and the plot spec', () => {
  it('is white at zero, red above, blue below and clipped', () => {
    expect(heatColor(0, 1)).toBe('rgb(255,255,255)');
    expect(heatColor(5, 1)).toBe(heatColor(1, 1));
    expect(heatColor(1, 1)).toMatch(/^rgb\(178,/);
    expect(heatColor(-1, 1)).toMatch(/^rgb\(33,/);
    expect(heatColor(NaN, 1)).toBe('#e6e6e6');
  });
  it('rounds the color limit up to a round number', () => {
    const m = pethModel(pairs, curves)!;
    expect(heatLimit(m.behaviors[0])).toBe(0.2);
  });
  it('builds a line plot of the population mean', () => {
    const m = pethModel(pairs, curves, metadata)!;
    const spec = pethMeanSpec(m, 0, { run_id: 'r1', engine: 'browser-ts' } as RunRecord);
    expect(spec.data.type).toBe('line');
    expect(spec.source.runId).toBe('r1');
    if (spec.data.type === 'line')
      expect(spec.data.spans.map((s) => s.label)).toEqual(['Baseline', 'Response']);
  });
});
