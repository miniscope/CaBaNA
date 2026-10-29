import { describe, expect, it } from 'vitest';
import { loadPopulationView, type PairwiseView, type SeparationView, type StabilityView, type MatrixView } from '../lib/population-results.ts';
import { checkManifest, UnsupportedVersion } from '../lib/results-load.ts';
import { openFixture } from './fixture-source.ts';

describe('population views read framework arrays', () => {
  const [d, src] = openFixture('population_social');

  it('PV similarity: pairs equal the framework matrix, with null range and p', async () => {
    const view = (await loadPopulationView(src, d.manifest, 'similarity')) as MatrixView;
    const n = view.states.length;
    expect(view.pairs).toHaveLength((n * (n - 1)) / 2);
    const first = view.pairs[0];
    expect(first.value).toBe(d.arrays.pv_similarity.values.data[0 * n + 1]);
    expect(first.p).toBe(d.arrays.pv_similarity.sh_p_value.data[0 * n + 1]);
    expect(view.label).toMatch(/cell shift.*upper tail.*Uncorrected p.*3 state pairs tested.*50 shuffles/s);
  });

  it('PV stability: half A and half B come from rate_map_a and rate_map_b', async () => {
    const view = (await loadPopulationView(src, d.manifest, 'stability')) as StabilityView;
    expect(view.r).toEqual(Array.from(d.arrays.pv_stability.values.data));
    const { a, b } = view.halves(1);
    expect(a).toHaveLength(150);
    expect(a[0]).toBe(d.arrays.pv_stability.extra_0.data[1]);
    expect(b[0]).toBe(d.arrays.pv_stability.extra_1.data[1]);
  });

  it('state separation: variance, cumulative and top loadings', async () => {
    const view = (await loadPopulationView(src, d.manifest, 'separation')) as SeparationView;
    expect(view.nComponents).toBe(10);
    expect(view.cumulative.at(-1)).toBeCloseTo(view.varianceExplained.reduce((s, v) => s + v, 0), 12);
    const top = view.topLoadings(0, 5);
    expect(top).toHaveLength(5);
    expect(Math.abs(top[0].loading)).toBeGreaterThanOrEqual(Math.abs(top[4].loading));
  });

  it('pairwise: descriptive only, off-diagonal pairs counted', async () => {
    const [dp, srcp] = openFixture('pairwise_social');
    const view = (await loadPopulationView(srcp, dp.manifest, 'pairwise')) as PairwiseView;
    expect(view.cells).toBe(150);
    expect(view.offDiagonal.length).toBeLessThanOrEqual((150 * 149) / 2);
    expect(view.label).toMatch(/no significance test/);
    expect(view.meanOffDiagonal).toBe(dp.arrays.pairwise.extra_1.data[0]);
  });

  it('returns nothing for a method that was not run', async () => {
    const [dp, srcp] = openFixture('pca_population');
    expect(await loadPopulationView(srcp, dp.manifest, 'stability')).toBeUndefined();
  });

  it('refuses results from a newer framework', () => {
    expect(() => checkManifest({ ...d.manifest, format: 3 })).toThrow(UnsupportedVersion);
    expect(() => checkManifest({ ...d.manifest, schema_version: '2.0.0' })).toThrow(UnsupportedVersion);
    expect(checkManifest(d.manifest).format).toBe(2);
  });
});
