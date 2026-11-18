import { describe, expect, it } from 'vitest';
import { frameworkAuroc, frameworkPlace } from '../lib/results-framework.ts';
import { openFixture } from './fixture-source.ts';

// Reads the framework test runs the way the explorer does, from their saved arrays.
describe('framework auROC and place cells in the explorer', () => {
  it('reads the auROC grid with labels from the saved p-values', async () => {
    const [, src] = openFixture('gui_auroc_circular');
    const m = (await frameworkAuroc(src, await src.manifest()))!;
    expect(m.cells.length).toBeGreaterThan(0);
    expect(m.behaviors.length).toBeGreaterThan(0);
    expect(m.auroc).toHaveLength(m.cells.length);
    expect(m.response[0]).toHaveLength(m.behaviors.length);
    expect(m.response.flat().every((v) => v !== '')).toBe(true);
  });

  it('reads place-cell values, outcomes and rate maps', async () => {
    const [, src] = openFixture('gui_place_cells');
    const p = (await frameworkPlace(src, await src.manifest()))!;
    expect(p.cells.length).toBeGreaterThan(0);
    expect(p.cells.every((c) => c.outcome)).toBe(true);
    expect(p.maps?.values.length).toBe(p.cells.length * p.maps!.nStates);
  });
});
