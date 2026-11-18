// The text of the QC pop-ups' flags box: numbered flags, then one line of what passed. Pure
// functions of the checks and per-cell notes the QC tests already compute.

import type { Check } from './qc.ts';

export interface FlagLine {
  n: number;
  title: string;
  detail: string;
}

const WITH = /^(low SNR|no events|dense events|events )/;

/** "3 cells correlated with a neighbor", "1 cell with low SNR". */
export const cellsPhrase = (count: number, note: string): string =>
  `${count} ${count === 1 ? 'cell' : 'cells'} ${WITH.test(note) ? 'with ' : ''}${note}`;

/** How many flagged cells have each note, most common first. */
export function noteCounts(notes: string[][]): { note: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const list of notes) for (const n of new Set(list)) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts]
    .map(([note, count]) => ({ note, count }))
    .sort((a, b) => b.count - a.count || a.note.localeCompare(b.note));
}

const measured = (c: Check) => [c.value, c.limit].filter(Boolean).join(' · ');

/**
 * Flags are the cells' notes (counted per kind), then every check that did not pass. Passed
 * checks are listed on one line with what was measured.
 */
export function flagLines(
  cellNotes: string[][],
  checks: Check[],
): { flags: FlagLine[]; passed: string } {
  const items = [
    ...noteCounts(cellNotes).map((x) => ({
      title: cellsPhrase(x.count, x.note),
      detail: '',
    })),
    ...checks
      .filter((c) => c.status !== 'pass')
      .map((c) => ({ title: c.title, detail: measured(c) })),
  ];
  const passed = checks
    .filter((c) => c.status === 'pass')
    .map((c) =>
      measured(c) ? `${c.title.toLowerCase()} (${measured(c)})` : c.title.toLowerCase(),
    );
  return {
    flags: items.map((x, i) => ({ n: i + 1, ...x })),
    passed: passed.length ? `Passed: ${passed.join(', ')}` : '',
  };
}

/** Footprint flags: one per overlapping pair, then any other check that did not pass. */
export function pairFlagLines(
  pairs: { a: number; b: number; note: string }[],
  checks: Check[],
): { flags: FlagLine[]; passed: string } {
  const rest = flagLines(
    [],
    checks.filter((c) => c.id !== 'fp-overlap' || c.status === 'pass'),
  );
  const items = [
    ...pairs.map((p) => ({ title: `Cells ${p.a + 1} and ${p.b + 1} overlap`, detail: p.note })),
    ...rest.flags,
  ];
  return {
    flags: items.map((x, i) => ({ n: i + 1, title: x.title, detail: x.detail })),
    passed: rest.passed,
  };
}
