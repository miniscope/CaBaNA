// Reading a framework result into typed objects. The bridge (or, in tests, a JSON dump of a
// results zip) supplies the arrays; nothing here computes a statistic. Views may sort, page and
// scale what they get; every reported number is read from an array (plan D-38).

import { decodeFloats, type Manifest, type ManifestResult } from './bridge-client.ts';

export const MAX_FORMAT = 2;
export const MAX_SCHEMA_MAJOR = 1;

export interface Nd {
  shape: number[];
  data: ArrayLike<number | null>;
}
export interface ResultSource {
  manifest(): Promise<Manifest>;
  array(result: string, key: string): Promise<Nd>;
}

export class UnsupportedVersion extends Error {}

/** Refuses results from a newer framework instead of rendering part of them. */
export function checkManifest(raw: Manifest): Manifest {
  const manifest = decodeFloats(raw);
  if (
    (manifest.format ?? 1) > MAX_FORMAT ||
    Number(String(manifest.schema_version ?? '1').split('.')[0]) > MAX_SCHEMA_MAJOR
  )
    throw new UnsupportedVersion(
      `Saved by a newer framework (format ${manifest.format}). Update the framework to open.`,
    );
  return manifest;
}

export interface Tested {
  /** Tail of the test (provenance). */
  tail: string | null;
  alpha: number | null;
  nShuffles: number | null;
  nullName: string | null;
  nullParams: Record<string, unknown>;
  correction: string | null;
  correctionScope: string | null;
  p: Nd;
  pAdj: Nd | null;
  nullLo: Nd | null;
  nullHi: Nd | null;
  significant: Nd | null;
  significantAdj: Nd | null;
}

export interface LoadedResult {
  meta: ManifestResult;
  values: Nd;
  tested?: Tested;
  extras: Record<string, Nd>;
  /** Load null draws on demand (the histogram view). Empty when they were not kept. */
  nullDraws: () => Promise<Nd | undefined>;
}

const optional = async (src: ResultSource, name: string, key: string) => {
  try {
    return await src.array(name, key);
  } catch {
    return null;
  }
};

/** One result with its test arrays. `extras` lists the extras to read (all when omitted). */
export async function loadResult(
  src: ResultSource,
  manifest: Manifest,
  name: string,
  extras?: string[],
): Promise<LoadedResult> {
  const meta = manifest.results.find((r) => r.name === name);
  if (!meta) throw new Error(`The results hold no analysis named "${name}".`);
  const wanted = extras ?? Object.keys(meta.extras_by_name ?? {});
  const values = await src.array(name, 'values');
  const loadedExtras: Record<string, Nd> = {};
  for (const key of wanted) {
    const nd = await optional(src, name, key);
    if (nd) loadedExtras[key] = nd;
  }
  const prov = meta.provenance as Record<string, unknown>;
  const shuffle = (meta.shuffle ?? {}) as Record<string, unknown>;
  let tested: Tested | undefined;
  const p = await optional(src, name, 'sh_p_value');
  if (p)
    tested = {
      p,
      pAdj: await optional(src, name, 'sh_p_adj'),
      nullLo: await optional(src, name, 'sh_null_lo'),
      nullHi: await optional(src, name, 'sh_null_hi'),
      significant: await optional(src, name, 'sh_significant'),
      significantAdj: await optional(src, name, 'sh_significant_adj'),
      tail: (shuffle.tail ?? prov.tail ?? null) as string | null,
      alpha: (shuffle.alpha ?? prov.alpha ?? null) as number | null,
      nShuffles: (shuffle.n_shuffles ?? prov.n_shuffles ?? null) as number | null,
      nullName: (shuffle.null_name ?? prov.null ?? null) as string | null,
      nullParams: (shuffle.null_info ?? {}) as Record<string, unknown>,
      correction: (shuffle.correction ?? null) as string | null,
      correctionScope: (shuffle.correction_scope ?? null) as string | null,
    };
  return {
    meta,
    values,
    tested,
    extras: loadedExtras,
    nullDraws: async () => (await optional(src, name, 'sh_null')) ?? undefined,
  };
}

/** Row-major element of a 2-D array. */
export const at2 = (nd: Nd, row: number, col: number): number | null =>
  nd.data[row * nd.shape[1] + col] ?? null;
export const finite = (v: number | null): v is number => v != null && Number.isFinite(v);

/** Significance text required next to every significance display (plan D-39). */
export function significanceLabel(
  t: Tested | undefined,
  o: { metric: string; unit: string; family?: string },
): string {
  if (!t) return 'Descriptive; no significance test.';
  const nullText = t.nullName
    ? `${t.nullName.replace(/_/g, ' ')}${Object.entries(t.nullParams)
        .map(([k, v]) => `, ${k.replace(/_/g, ' ')} ${String(v)}`)
        .join('')}`
    : 'null not recorded';
  const corrected = t.correction && t.correction !== 'none';
  const family = corrected
    ? `${t.correction!.replace(/_/g, ' ')} correction across ${o.family ?? 'the tests'}`
    : `Uncorrected p${o.family ? ` (${o.family})` : ''}`;
  return [
    `${o.metric} against a ${nullText} null`,
    `${t.tail ?? 'tail not recorded'} tail`,
    family,
    `alpha ${t.alpha ?? '?'}`,
    `${t.nShuffles ?? '?'} shuffles`,
    `unit of inference: ${o.unit}`,
  ].join('; ');
}
