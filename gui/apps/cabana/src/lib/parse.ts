// Reading the files a user drops in. Arrays come from @calab/io (.npy, .npz or .mat); tables are
// plain CSV (no quoted commas).

import { parseMat, parseNpy, parseNpz, traceCandidates } from '@calab/io';
import type { NpzResult } from '@calab/core';

export interface Matrix {
  data: Float32Array | Float64Array;
  cells: number;
  frames: number;
}

export interface Table {
  columns: string[];
  rows: string[][];
}

const kindOf = (name: string) => /\.(npz|mat)$/i.exec(name)?.[1].toLowerCase() ?? 'npy';

/**
 * The one array of `dims` dimensions in a .npz or .mat file. Several that fit are an error naming
 * them, since picking one silently could analyze the wrong data.
 */
export function pickArray(result: NpzResult, dims: 2 | 3): string {
  const fits =
    dims === 2
      ? traceCandidates(result).filter((n) => result.arrays[n].shape.every((d) => d > 1))
      : result.arrayNames.filter((n) => result.arrays[n].shape.length === 3);
  if (fits.length === 1) return fits[0];
  const what = dims === 2 ? '2D array (cells x frames)' : '3D array (cells x height x width)';
  if (!fits.length)
    throw new Error(
      `No ${what} in this file. It holds: ${result.arrayNames.map((n) => `${n} (${result.arrays[n].shape.join(' x ')})`).join(', ') || 'nothing'}.`,
    );
  throw new Error(
    `This file holds several arrays that could be the data: ${fits.join(', ')}. Save the one to use on its own.`,
  );
}

/**
 * Parse an array file (.npy, .npz or .mat), with a clearer message when the file is really a web
 * page (a failed download). From .npz and .mat the one array of `dims` dimensions is taken.
 */
async function readArray(file: File, dims: 2 | 3) {
  const buf = await file.arrayBuffer();
  if (new Uint8Array(buf, 0, 1)[0] === 0x3c)
    throw new Error('This is a web page, not an array file. Reload the app and try again.');
  const kind = kindOf(file.name);
  const arr =
    kind === 'npy'
      ? parseNpy(buf)
      : (() => {
          const all = kind === 'npz' ? parseNpz(buf) : parseMat(buf);
          return all.arrays[pickArray(all, dims)];
        })();
  const { data, shape, fortranOrder } = arr;
  return { data: fortranOrder ? toCOrder(data, shape) : data, shape };
}

/** NumPy saves a transposed array column by column (Fortran order). Reorder it to row by row. */
function toCOrder<T extends ArrayLike<number>>(data: T, shape: number[]): T {
  const out = new (data.constructor as new (n: number) => T)(data.length);
  const strides = shape.map((_, d) => shape.slice(0, d).reduce((a, b) => a * b, 1));
  const idx = new Array<number>(shape.length).fill(0);
  for (let i = 0; i < data.length; i++) {
    let src = 0;
    for (let d = 0; d < shape.length; d++) src += idx[d] * strides[d];
    (out as unknown as number[])[i] = data[src];
    for (let d = shape.length - 1; d >= 0 && ++idx[d] === shape[d]; d--) idx[d] = 0;
  }
  return out;
}

export async function readMatrix(file: File): Promise<{ matrix: Matrix; note?: string }> {
  const { data, shape } = await readArray(file, 2);
  if (shape.length !== 2)
    throw new Error(`Expected a 2D array (cells x frames), got shape ${shape.join(' x ')}.`);
  const [cells, frames] = shape;
  const note = cells > frames ? 'More cells than frames. Is this frames x cells?' : undefined;
  return { matrix: { data: data as Float32Array | Float64Array, cells, frames }, note };
}

export interface Footprints {
  data: Float32Array | Float64Array;
  cells: number;
  height: number;
  width: number;
}

export async function readFootprints(file: File): Promise<Footprints> {
  const { data, shape } = await readArray(file, 3);
  if (shape.length !== 3)
    throw new Error(`Expected cells x height x width, got shape ${shape.join(' x ')}.`);
  return {
    data: data as Float32Array | Float64Array,
    cells: shape[0],
    height: shape[1],
    width: shape[2],
  };
}

export async function readTable(file: File): Promise<Table> {
  const lines = (await file.text()).split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('The file has no data rows.');
  const split = (l: string) => l.split(',').map((c) => c.trim());
  return { columns: split(lines[0]), rows: lines.slice(1).map(split) };
}

/** A numeric column by case-insensitive name (substring match). */
export function column(t: Table, name: string): number[] {
  const i = t.columns.findIndex((c) => c.toLowerCase().includes(name));
  if (i < 0) throw new Error(`No "${name}" column. Found: ${t.columns.join(', ')}.`);
  return t.rows.map((r) => Number(r[i]));
}
