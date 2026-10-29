// CSV text to a table, for files already read as a string (parse.ts reads File objects).
// Plain CSV only (no quoted commas). Empty cells are kept, because blank means missing.

import type { Table } from './parse.ts';

export function parseCsvText(text: string): Table {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { columns: [], rows: [] };
  const split = (l: string) => l.split(',').map((c) => c.trim());
  return { columns: split(lines[0]), rows: lines.slice(1).map(split) };
}
