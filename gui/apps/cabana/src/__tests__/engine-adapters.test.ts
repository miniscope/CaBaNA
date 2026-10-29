// The place-cell and auROC adapters read a framework run into the shapes the results views use.
// Every displayed value must equal the framework array, and the engine rules must hold.

import { describe, expect, it } from 'vitest';
import { aurocFromFramework, savedDrawsOfCell } from '../lib/auroc-results.ts';
import { shiftedValues, type AurocOutcome } from '../lib/auroc-run.ts';
import { describeChanges, engineFor, PLACE_LABELS } from '../lib/engine.ts';
import { gridOrder, placeFromFramework, tauFromNote } from '../lib/place-results.ts';
import type { Manifest } from '../lib/bridge-client.ts';
import type { ResultSource } from '../lib/results-load.ts';
import { setSource } from '../lib/store.ts';
import { aurocSettings, setAurocSettings } from '../lib/auroc-run.ts';
import { openFixture, type Dump } from './fixture-source.ts';

/** An array of a result, by the stored key or by the extra's name. */
function arr(d: Dump, result: string, key: string): number[] {
  const entry = d.manifest.results.find((r) => r.name === result) as unknown as {
    extras: Record<string, string>;
  };
  const stored = Object.entries(entry.extras).find(([, name]) => name === key)?.[0] ?? key;
  return d.arrays[result][stored].data as number[];
}
const same = (got: ArrayLike<number>, want: (number | null)[]) =>
  expect(Array.from(got, (v) => (Number.isNaN(v) ? null : v))).toEqual(want);

/** The same run with part of it taken away, to test what the adapters do without it. */
function without(src: ResultSource, o: { draws?: boolean; selections?: boolean }): ResultSource {
  return {
    manifest: async () => {
      const m: Manifest = structuredClone(await src.manifest());
      if (o.selections)
        for (const r of m.results) (r.provenance as { selections?: unknown }).selections = [];
      return m;
    },
    array: async (result, key) => {
      if (o.draws && key === 'sh_null') throw new Error('not kept');
      return src.array(result, key);
    },
  };
}

describe('place cells from a framework run', () => {
  const [d, src] = openFixture('gui_place_cells');
  const fallback = { sigma: 2, minShiftS: 7, alpha: 0.05 };

  it('shows the framework values, p-values and fields as they are stored', async () => {
    const { result: r } = await placeFromFramework(src, fallback);
    same(r.information, arr(d, 'information', 'values'));
    same(r.pInformation, arr(d, 'information', 'sh_p_value'));
    same(r.stability, arr(d, 'stability', 'values'));
    same(r.pStability, arr(d, 'stability', 'sh_p_value'));
    same(r.inOut, arr(d, 'fields', 'values'));
    same(r.pFields, arr(d, 'fields', 'sh_p_value'));
    same(r.nFields, arr(d, 'fields', 'n_fields'));
    same(r.peak, arr(d, 'fields', 'peak_rate'));
    expect(r.cells).toBe(120);
    expect(r.nStates).toBe(196); // 14 x 14 bins of 3 cm over 40 cm
  });

  it('takes the rate maps from rate_map, rate_map_a and rate_map_b', async () => {
    const { result: r } = await placeFromFramework(src, fallback);
    // The views hold maps as 32-bit numbers and read state = row * nx + column; the framework
    // numbers a grid state = ix * ny + iy (14 x 14 bins here), so the map is transposed.
    const [nx, ny, n] = [14, 14, 196];
    const maps: [Float32Array | Uint8Array, string, string][] = [
      [r.rate, 'fields', 'rate_map'],
      [r.rateA, 'stability', 'rate_map_a'],
      [r.rateB, 'stability', 'rate_map_b'],
      [r.fieldLabels, 'fields', 'field_labels'],
    ];
    for (const [got, result, key] of maps) {
      const want = arr(d, result, key);
      const f32 = got instanceof Float32Array;
      for (const [c, ix, iy] of [
        [0, 0, 1],
        [5, 3, 9],
        [119, 13, 0],
        [60, 7, 7],
      ]) {
        const v = want[c * n + ix * ny + iy];
        expect(got[c * n + iy * nx + ix]).toBe(
          v === null ? (f32 ? NaN : 0) : f32 ? Math.fround(v) : v,
        );
      }
    }
  });

  it('calls a place cell when information and stability are both significant at alpha', async () => {
    const { result: r, alpha } = await placeFromFramework(src, fallback);
    const pi = arr(d, 'information', 'sh_p_value');
    const ps = arr(d, 'stability', 'sh_p_value');
    expect(alpha).toBe(0.05);
    const want = pi.map((p, i) => (p < alpha && ps[i] < alpha ? 1 : 0));
    expect(Array.from(r.placeCell)).toEqual(want);
    expect(want.some((v) => v === 1)).toBe(true);
    expect(want.some((v) => v === 0)).toBe(true);
  });

  it('turns the shifted values from shuffle x cell into cell x shuffle', async () => {
    const {
      result: r,
      nShuffles,
      distinctShifts,
      nullKept,
    } = await placeFromFramework(src, fallback);
    const draws = arr(d, 'information', 'sh_null');
    expect(nullKept).toBe(true);
    expect(nShuffles).toBe(25);
    expect(r.nShifts).toBe(25);
    for (const [c, s] of [
      [0, 0],
      [7, 3],
      [119, 24],
    ])
      expect(r.nullInformation[c * 25 + s]).toBe(draws[s * 120 + c]);
    expect(distinctShifts).toBe(new Set(arr(d, 'information', 'sh_shifts')).size);
  });

  it('reads the smoothing and shift choices from the run provenance', async () => {
    const fw = await placeFromFramework(src, fallback);
    const sel = (
      d.manifest.results[0].provenance as {
        selections: { path: string; value: number; scores: number[]; note: string }[];
      }
    ).selections;
    const sigma = sel.find((s) => s.path.endsWith('smooth_sigma_bins'))!;
    const shift = sel.find((s) => s.path.endsWith('min_shift_s'))!;
    expect(fw.sigma).toBe(sigma.value);
    expect(fw.sigmaChoice?.scores).toEqual(sigma.scores);
    expect(fw.sigmaChoice?.best).toBe(
      fw.sigmaChoice!.candidates[sigma.scores.indexOf(Math.max(...sigma.scores))],
    );
    expect(fw.minShiftS).toBe(shift.value);
    expect(fw.timescale?.note).toBe(shift.note);
    expect(fw.timescale?.tauNeuralS).toBe(tauFromNote(shift.note, 'tau_activity'));
    expect(fw.timescale?.tauNeuralS).toBeGreaterThan(0);
    expect(fw.timescale?.tauPositionS).toBe(tauFromNote(shift.note, 'tau_target'));
  });

  it('reports the settings when nothing was chosen from the data, and no draws when they were not kept', async () => {
    const fw = await placeFromFramework(without(src, { selections: true, draws: true }), fallback);
    expect(fw.sigmaChoice).toBeUndefined();
    expect(fw.timescale).toBeUndefined();
    expect(fw.sigma).toBe(1); // the sigma the run's information metric used
    expect(fw.minShiftS).toBe(7);
    expect(fw.nullKept).toBe(false);
    expect(fw.result.nullInformation.every(Number.isNaN)).toBe(true);
  });

  it('refuses a run that did not finish the three analyses', async () => {
    const partial: ResultSource = {
      ...src,
      manifest: async () => ({ ...(await src.manifest()), results: [] }),
    };
    await expect(placeFromFramework(partial, fallback)).rejects.toThrow(/did not finish/);
  });

  it('reorders a grid from x-major to row-major without changing values', () => {
    // 2 bins in x, 3 in y, one cell: framework state ix * 3 + iy
    const framework = Float32Array.from([0, 1, 2, 10, 11, 12]);
    expect(Array.from(gridOrder(framework, 1, [2, 3]))).toEqual([0, 10, 1, 11, 2, 12]);
  });

  it('reads taus from a selector note', () => {
    expect(tauFromNote('tau_activity=0.133s, tau_target=8.04s, multiple=3', 'tau_target')).toBe(
      8.04,
    );
    expect(tauFromNote('no numbers here', 'tau_target')).toBeNaN();
  });
});

describe('auROC from a framework run', () => {
  const [d, src] = openFixture('gui_auroc_circular');

  it('shows the framework observed values and p-values as they are stored', async () => {
    const fw = await aurocFromFramework(src, 20);
    expect(fw.labels).toEqual(['follow', 'sniff_anogenital', 'sniff_face']);
    same(fw.result.observed, arr(d, 'auroc', 'values'));
    same(fw.result.pRaw, arr(d, 'auroc', 'sh_p_value'));
    same(fw.result.pAdj, arr(d, 'auroc', 'sh_p_adj'));
    same(fw.shifts, arr(d, 'auroc', 'sh_shifts'));
    expect(fw.nInState).toEqual(arr(d, 'auroc', 'n_in_state'));
    expect(fw.matched).toBeUndefined();
  });

  it('takes the minimum shift from the automatic choice in the provenance', async () => {
    const fw = await aurocFromFramework(src, 20);
    expect(fw.minShiftS).toBe(24.118);
    expect(fw.timescale?.tauBehaviorS).toBeCloseTo(8.04, 2);
    const manual = await aurocFromFramework(without(src, { selections: true }), 20);
    expect(manual.minShiftS).toBe(20);
    expect(manual.timescale).toBeUndefined();
  });

  it('gives one cell its saved shifted values, shuffles x behaviors', async () => {
    const fw = await aurocFromFramework(src, 20);
    const draws = arr(d, 'auroc', 'sh_null');
    const [shuffles, cells, behaviors] = [20, 150, 3];
    expect(fw.draws).toMatchObject({ shuffles, cells, behaviors });
    const cell = 42;
    const got = savedDrawsOfCell(fw.draws!, cell);
    expect(got).toHaveLength(shuffles * behaviors);
    for (let s = 0; s < shuffles; s++)
      for (let b = 0; b < behaviors; b++)
        expect(got[s * behaviors + b]).toBe(draws[(s * cells + cell) * behaviors + b]);
  });

  it('shiftedValues takes the framework draws, never a recomputation', async () => {
    const fw = await aurocFromFramework(src, 20);
    const out = { engine: 'framework', draws: fw.draws } as AurocOutcome;
    expect(Array.from(shiftedValues(out, 3))).toEqual(Array.from(savedDrawsOfCell(fw.draws!, 3)));
    expect(shiftedValues({ engine: 'framework' } as AurocOutcome, 3)).toHaveLength(0);
  });

  it('has no draws when they were not kept', async () => {
    const fw = await aurocFromFramework(without(src, { draws: true }), 20);
    expect(fw.draws).toBeUndefined();
  });

  it('reads the speed-matching diagnostics of a speed-matched run', async () => {
    const [ds, srcs] = openFixture('gui_auroc_speed_matched');
    const fw = await aurocFromFramework(srcs, 20);
    const info = (ds.manifest.results[0].shuffle as { null_info: Record<string, number> })
      .null_info;
    expect(fw.matched?.candidates).toBe(info.n_candidates);
    expect(fw.matched?.acceptanceRate).toBe(info.acceptance_rate);
    expect(fw.matched?.balanceMax).toBe(info.balance_max);
    expect(fw.matched?.balanceMean).toBe(info.balance_mean);
    expect(fw.minShiftS).toBe(20); // the automatic shift does not act on a speed-matched null
    same(fw.result.observed, arr(ds, 'auroc', 'values'));
  });
});

describe('which engine runs', () => {
  it('uses the framework unless positions are pixels (place) or A is compared with B (auROC)', () => {
    expect(engineFor('place')).toBe('framework');
    setSource('positionUnit', 'px');
    expect(engineFor('place')).toBe('browser');
    setSource('positionUnit', 'cm');
    expect(engineFor('place')).toBe('framework');

    expect(engineFor('auroc')).toBe('framework');
    setAurocSettings('compare', 'behavior');
    expect(engineFor('auroc')).toBe('browser');
    setAurocSettings('compare', aurocSettings.compare === 'behavior' ? 'rest' : 'rest');
    expect(engineFor('auroc')).toBe('framework');
  });

  it('puts each changed setting once, in words', () => {
    const diff = [
      'analysis.alpha: 0.05 -> 0.01',
      'analysis.sigmaAuto: true -> false',
      'analysis.sigma: unset -> 2',
      'prep.minSpeed: 2 -> 3',
      'rejected: [] -> [3]',
    ];
    expect(describeChanges(diff, PLACE_LABELS)).toEqual([
      'significance threshold',
      'smoothing',
      'minimum speed',
      'rejected cells',
    ]);
  });
});
