// The numbers the Population views draw are the framework's arrays: the pair table, the dot
// plot data and the histogram input are checked against the fixture arrays.

import { describe, expect, it } from 'vitest';
import {
  loadPopulationView,
  type MatrixView,
  type PairwiseView,
  type StabilityView,
} from '../lib/population-results.ts';
import { histogram, matrixCsv, pairsCsv, perStateCsv } from '../panels/population/logic.ts';
import { openFixture } from './fixture-source.ts';

describe('population views equal the framework arrays', () => {
  const [d, src] = openFixture('population_social');

  it('the pair table and its CSV hold the framework matrix values, null ranges and p', async () => {
    const v = (await loadPopulationView(src, d.manifest, 'similarity')) as MatrixView;
    const n = v.states.length;
    const a = d.arrays.pv_similarity;
    const { rows } = pairsCsv(v.pairs);
    let k = 0;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++, k++) {
        expect(rows[k][0]).toBe(v.states[i]);
        expect(rows[k][2]).toBe(a.values.data[i * n + j]);
        expect(rows[k][3]).toBe(a.sh_null_lo.data[i * n + j]);
        expect(rows[k][4]).toBe(a.sh_null_hi.data[i * n + j]);
        expect(rows[k][5]).toBe(a.sh_p_value.data[i * n + j]);
      }
    expect(rows).toHaveLength(3);
  });

  it('the stability table repeats the framework r, null range and p for each state', async () => {
    const v = (await loadPopulationView(src, d.manifest, 'stability')) as StabilityView;
    const a = d.arrays.pv_stability;
    const { header, rows } = perStateCsv(v.states, {
      r: v.r,
      null_low: v.nullLo,
      null_high: v.nullHi,
      p: v.p,
    });
    expect(header).toEqual(['state', 'r', 'null_low', 'null_high', 'p']);
    v.states.forEach((s, i) => {
      expect(rows[i]).toEqual([
        s,
        a.values.data[i],
        a.sh_null_lo.data[i],
        a.sh_null_hi.data[i],
        a.sh_p_value.data[i],
      ]);
    });
  });

  it('the framework records alpha, shuffles and correction that the summary line prints', () => {
    const shuffle = d.manifest.results.find((r) => r.name === 'pv_similarity')!.shuffle as Record<
      string,
      unknown
    >;
    expect(shuffle.alpha).toBe(0.05);
    expect(shuffle.n_shuffles).toBe(50);
    expect(shuffle.correction).toBe('none');
  });

  it('the matrix CSV is the loaded matrix row by row', async () => {
    const v = (await loadPopulationView(src, d.manifest, 'separation')) as MatrixView;
    const { rows } = matrixCsv(v.states, v.values.data);
    expect(rows[1].slice(1)).toEqual(
      Array.from({ length: 3 }, (_, j) => d.arrays.state_separation.values.data[3 + j]),
    );
  });

  it('the histogram holds every finite off-diagonal value of the pairwise matrix once', async () => {
    const [dp, srcp] = openFixture('pairwise_social');
    const v = (await loadPopulationView(srcp, dp.manifest, 'pairwise')) as PairwiseView;
    const h = histogram(v.offDiagonal, 40);
    expect(h.counts.reduce((s, c) => s + c, 0)).toBe(v.offDiagonal.length);
    expect(v.offDiagonal.length).toBeLessThanOrEqual((150 * 149) / 2);
    expect(Math.min(...v.offDiagonal)).toBeCloseTo(h.edges[0], 12);
  });
});
