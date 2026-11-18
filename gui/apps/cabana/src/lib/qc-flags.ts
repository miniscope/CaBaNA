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

/** Flags that are a list of items (pairs, segments), then every other check that did not pass. */
export function itemFlagLines(
  items: { title: string; detail: string }[],
  checks: Check[],
): { flags: FlagLine[]; passed: string } {
  const rest = flagLines([], checks);
  return {
    flags: [...items, ...rest.flags].map((x, i) => ({
      n: i + 1,
      title: x.title,
      detail: x.detail,
    })),
    passed: rest.passed,
  };
}

/** Footprint flags: one per overlapping pair. The overlap check itself is those pairs, so it is not repeated. */
export function pairFlagLines(
  pairs: { a: number; b: number; note: string }[],
  checks: Check[],
): { flags: FlagLine[]; passed: string } {
  return itemFlagLines(
    pairs.map((p) => ({ title: `Cells ${p.a + 1} and ${p.b + 1} overlap`, detail: p.note })),
    checks.filter((c) => c.id !== 'fp-overlap' || c.status === 'pass'),
  );
}

export const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

/** A position segment as a flag: "Jump at 2:14.3", "80 cm/s over 3 steps". */
export function segmentLine(s: {
  kind: 'jump' | 'lost';
  start: number;
  stop: number;
  n: number;
  peak?: number;
}): { title: string; detail: string } {
  return s.kind === 'jump'
    ? {
        title: `Jump at ${clock(s.start)}`,
        detail: `${s.peak!.toFixed(0)} cm/s${s.n > 1 ? ` over ${s.n} steps` : ''}`,
      }
    : {
        title: `Lost for ${(s.stop - s.start).toFixed(1)} s at ${clock(s.start)}`,
        detail: `${s.n} frames`,
      };
}
