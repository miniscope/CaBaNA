import { describe, expect, it } from 'vitest';
import { parseSavedCsv } from '../lib/results-explorer.ts';
import {
  aurocModel,
  aurocOrder,
  outcomeCounts,
  placeCells,
  responseCounts,
} from '../lib/results-saved.ts';
import { headlineOf } from '../lib/results-table.ts';

const auroc = parseSavedCsv(
  'auroc.csv',
  [
    'cell,behavior,auroc,p_unadjusted,p_adjusted,response',
    '1,a,0.8,0.01,0.02,Excited',
    '1,b,0.5,0.5,0.9,Not significant',
    '2,a,0.2,0.01,0.02,Inhibited',
    '2,b,,,,Not evaluated',
  ].join('\n'),
);
const place = parseSavedCsv(
  'place_cells.csv',
  [
    '# note',
    'cell,outcome,information,p_information,stability,p_stability,in_out_ratio,p_in_out_ratio,n_fields,peak_rate',
    '1,both,0.5,0.01,0.8,0.01,3,0.02,1,5',
    '2,neither,0.1,0.5,0.1,0.5,1,0.5,0,2',
    '3,cannot,,,,,,,,',
  ].join('\n'),
);

describe('saved auROC', () => {
  const m = aurocModel(auroc)!;
  it('reads the grid of cells and behaviors', () => {
    expect(m.behaviors).toEqual(['a', 'b']);
    expect(m.cells).toEqual([1, 2]);
    expect(m.auroc[1][0]).toBe(0.2);
  });
  it('counts labels overall and per behavior', () => {
    expect(responseCounts(m)).toMatchObject({
      excited: 1,
      inhibited: 1,
      evaluated: 3,
      notEvaluated: 1,
    });
    expect(responseCounts(m, 1)).toMatchObject({ excited: 0, evaluated: 1 });
  });
  it('orders by auROC with blanks last', () => {
    expect(aurocOrder(m, 0)).toEqual([0, 1]);
    expect(aurocOrder(m, 1)).toEqual([0, 1]);
  });
  it('rejects other tables', () => expect(aurocModel(place)).toBeUndefined());
});

describe('saved place cells', () => {
  it('reads cells and counts outcomes', () => {
    const cells = placeCells(place)!;
    expect(cells).toHaveLength(3);
    expect(outcomeCounts(cells)).toMatchObject({ both: 1, neither: 1, cannot: 1 });
  });
  it('writes the headline from the outcome', () => {
    const data = {
      tables: [place],
      stats: [],
      summary: { settings: {}, stats: [] },
      resultNames: [],
    };
    expect(headlineOf('place', data)).toBe('1 of 2 cells pass both place-cell tests');
  });
});

describe('decoding headline', () => {
  it('gives the range of the saved statistic when nothing was tested', () => {
    const data = {
      tables: [],
      stats: [
        { name: 'decoding (accuracy)', unit: '', n: 5, range: [0.55, 0.9] as [number, number] },
      ],
      summary: { settings: {}, stats: [] },
      resultNames: [],
    };
    expect(headlineOf('decoding', data)).toBe('decoding (accuracy): 0.55 to 0.9');
  });
});
