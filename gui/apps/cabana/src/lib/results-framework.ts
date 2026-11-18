// What the explorer reads from a framework run's saved arrays beyond its tables: the auROC grid
// and the place-cell values and rate maps. Values, p-values and maps are read as saved; the
// response and outcome labels apply the same alpha rule the results pages use.

import type { Manifest, RunRecord } from './bridge-client.ts';
import { responseOf } from './auroc.ts';
import { gridOrder } from './place-results.ts';
import { loadResult, type Nd, type ResultSource } from './results-load.ts';
import { runSource } from './results-store.ts';
import type { AurocModel } from './results-saved.ts';
import type { Overall } from './place-outcome.ts';
import type { PlaceCell } from './results-saved.ts';

const nums = (nd: Nd) => Array.from(nd.data as ArrayLike<number | null>, (v) => v ?? NaN);
const RESPONSE_TEXT = {
  excited: 'Excited',
  inhibited: 'Inhibited',
  'not significant': 'Not significant',
  'not evaluated': 'Not evaluated',
} as const;

/** The auROC grid of a framework run (`auroc` result), with the saved adjusted p-values. */
export async function frameworkAuroc(
  src: ResultSource,
  manifest: Manifest,
): Promise<AurocModel | undefined> {
  if (!manifest.results.some((r) => r.name === 'auroc')) return undefined;
  const r = await loadResult(src, manifest, 'auroc', []);
  const [nCells, nBeh] = r.values.shape;
  const values = nums(r.values);
  const p = r.tested ? nums(r.tested.pAdj ?? r.tested.p) : undefined;
  const alpha = r.tested?.alpha ?? NaN;
  const ids = r.meta.cell_ids ?? Array.from({ length: nCells }, (_, i) => i);
  const grid = <T>(f: (i: number, j: number) => T) =>
    Array.from({ length: nCells }, (_, i) => Array.from({ length: nBeh }, (_, j) => f(i, j)));
  return {
    behaviors: r.meta.state_names ?? Array.from({ length: nBeh }, (_, j) => `Behavior ${j + 1}`),
    cells: ids.map((id) => Number(id) + 1),
    auroc: grid((i, j) => values[i * nBeh + j]),
    pAdj: grid((i, j) => p?.[i * nBeh + j] ?? NaN),
    response: grid((i, j) =>
      p ? RESPONSE_TEXT[responseOf(values[i * nBeh + j], p[i * nBeh + j], alpha)] : '',
    ),
  };
}

export interface PlaceMaps {
  /** Rate maps, cells x (ny * nx), states in the order the views read. */
  values: Float32Array;
  nStates: number;
  nx: number;
  ny: number;
}

/** The three place-cell results of a framework run, with the rate maps when the run saved them. */
export async function frameworkPlace(
  src: ResultSource,
  manifest: Manifest,
): Promise<{ cells: PlaceCell[]; maps?: PlaceMaps; alpha?: number } | undefined> {
  const names = ['information', 'stability', 'fields'];
  if (!names.every((n) => manifest.results.some((r) => r.name === n))) return undefined;
  const [info, stab, fields] = await Promise.all(names.map((n) => loadResult(src, manifest, n)));
  if (!info.tested || !stab.tested) return undefined;
  const alpha = info.tested.alpha ?? undefined;
  const [pI, pS] = [nums(info.tested.p), nums(stab.tested.p)];
  const [vI, vS] = [nums(info.values), nums(stab.values)];
  const nFields = fields.extras.n_fields ? nums(fields.extras.n_fields) : [];
  const peak = fields.extras.peak_rate ? nums(fields.extras.peak_rate) : [];
  const test = (p: number) => (Number.isNaN(p) || alpha === undefined ? undefined : p < alpha);
  const ids = info.meta.cell_ids ?? vI.map((_, i) => i);
  const cells = vI.map((_, i): PlaceCell => {
    const [a, b] = [test(pI[i]), test(pS[i])];
    const outcome: Overall =
      a === undefined || b === undefined
        ? 'cannot'
        : a && b
          ? 'both'
          : a
            ? 'info'
            : b
              ? 'stab'
              : 'neither';
    return {
      cell: Number(ids[i]) + 1,
      outcome,
      information: vI[i],
      stability: vS[i],
      nFields: nFields[i] ?? NaN,
      peakRate: peak[i] ?? NaN,
    };
  });
  const rate = fields.extras.rate_map;
  const shape = (fields.meta.provenance as { target_shape?: number[] }).target_shape;
  let maps: PlaceMaps | undefined;
  if (rate && shape?.length === 2) {
    const [nx, ny] = [shape[0], shape[1]];
    const flat = Float32Array.from(rate.data as ArrayLike<number | null>, (v) => v ?? NaN);
    maps = { values: gridOrder(flat, cells.length, [nx, ny]), nStates: nx * ny, nx, ny };
  }
  return { cells, maps, alpha };
}

export interface FrameworkExtra {
  src: ReturnType<typeof runSource>;
  manifest: Manifest;
  auroc?: AurocModel;
  place?: Awaited<ReturnType<typeof frameworkPlace>>;
}

/** Everything the explorer reads from a framework run's arrays, by analysis. */
export async function loadFrameworkExtra(r: RunRecord): Promise<FrameworkExtra> {
  const src = runSource(r.run_id);
  const manifest = await src.manifest();
  return {
    src,
    manifest,
    auroc: r.analysis === 'auroc' ? await frameworkAuroc(src, manifest) : undefined,
    place: r.analysis === 'place' ? await frameworkPlace(src, manifest) : undefined,
  };
}
