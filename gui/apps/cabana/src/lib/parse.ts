// Reading the files a user drops in. Arrays come from @calab/io; tables are
// plain CSV (no quoted commas).

import { parseNpy } from '@calab/io';

export interface Matrix {
  data: Float32Array | Float64Array;
  cells: number;
  frames: number;
}

export interface Table {
  columns: string[];
  rows: string[][];
}

/** Parse an .npy file, with a clearer message when the file is really a web page (a failed download). */
async function readNpy(file: File) {
  const buf = await file.arrayBuffer();
  if (new Uint8Array(buf, 0, 1)[0] === 0x3c)
    throw new Error('This is a web page, not a NumPy file. Reload the app and try again.');
  const { data, shape, fortranOrder } = parseNpy(buf);
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
  const { data, shape } = await readNpy(file);
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
  const { data, shape } = await readNpy(file);
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
