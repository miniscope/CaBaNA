// The QC flags of the Data setup view pop-up: each check that did not pass becomes a numbered flag,
// and each flag knows where it is on the plot (cells, or stretches of the session), so the number
// in the list matches the marker drawn. Pure functions; the pop-up supplies the real checks.

import { cellsPhrase, noteCounts } from './qc-flags.ts';
import type { Check } from './qc.ts';

export interface QcFlag {
  /** 1-based, the same number as the marker on the plot. */
  n: number;
  title: string;
  /** Value and limit, or what the pair shares. */
  text: string;
  /** What to do about it, when the check says. */
  fix?: string;
  /** Zero-based cells the flag points at. */
  cells?: number[];
  /** The flag is one overlapping pair, already named in its title. */
  pair?: boolean;
  /** Stretches of the session in seconds. */
  spans?: [number, number][];
}

export interface QcPassed {
  title: string;
  value: string;
}

/** Where a check's flag is on the plot, when it has a place. */
export interface Where {
  cells?: number[];
  spans?: [number, number][];
}

const text = (c: Check) => [c.value, c.limit].filter(Boolean).join(' · ');

/**
 * Numbered flags and the passed checks. A check with cell pairs gives one flag per pair; any other
 * check that did not pass gives one flag. `where` places a flag by the check's id. `cellNotes`
 * (see cellNoteFlags) come first, as in the QC pop-up.
 */
export function splitChecks(
  checks: Check[],
  where: Record<string, Where> = {},
  cellNotes: Omit<QcFlag, 'n'>[] = [],
): { flags: QcFlag[]; passed: QcPassed[] } {
  const flags: QcFlag[] = [];
  const passed: QcPassed[] = [];
  const add = (f: Omit<QcFlag, 'n'>) => flags.push({ n: flags.length + 1, ...f });
  cellNotes.forEach(add);
  // Pairs first: each is a place on the map.
  for (const c of checks)
    for (const p of c.pairs ?? [])
      add({
        title: `Cells ${p.a + 1} and ${p.b + 1} overlap`,
        text: p.note,
        fix: c.fix,
        cells: [p.a, p.b],
        pair: true,
      });
  for (const c of checks) {
    if (c.status === 'pass') passed.push({ title: c.title, value: text(c) });
    else add({ title: c.title, text: text(c), fix: c.fix, ...where[c.id] });
  }
  return { flags, passed };
}

/**
 * One flag per kind of cell note ("12 cells correlated with a neighbor"), most common first, with
 * the cells it points at. These are the flags the QC pop-up lists, so the view and the pop-up agree
 * even when a check as a whole passes (it allows a share of poor cells). Rejected cells are left out.
 */
export function cellNoteFlags(
  scores: { notes: string[]; rejected: boolean }[],
): { title: string; text: string; cells: number[] }[] {
  const flagged = scores.flatMap((s, c) =>
    !s.rejected && s.notes.length ? [{ c, notes: s.notes }] : [],
  );
  return noteCounts(flagged.map((f) => f.notes)).map(({ note, count }) => ({
    title: cellsPhrase(count, note),
    text: '',
    cells: flagged.filter((f) => f.notes.includes(note)).map((f) => f.c),
  }));
}

type Level = 'good' | 'warn' | 'bad';
interface Scored {
  snrLevel: Level;
  corrLevel: Level;
  eventLevel: Level;
  rejected: boolean;
}

/** Cells that are not good for each cell check, by the check's id. Rejected cells are left out. */
export function cellsByCheck(scores: Scored[]): Record<'snr' | 'corr' | 'events', number[]> {
  const pick = (key: 'snrLevel' | 'corrLevel' | 'eventLevel') =>
    scores.flatMap((s, c) => (!s.rejected && s[key] !== 'good' ? [c] : []));
  return { snr: pick('snrLevel'), corr: pick('corrLevel'), events: pick('eventLevel') };
}

/** Vertical position of each cell's row as a fraction of the plot's height (0 top, 1 bottom). */
export const rowFractions = (cells: number[], order: number[]): number[] =>
  cells
    .map((c) => order.indexOf(c))
    .filter((r) => r >= 0)
    .map((r) => (r + 0.5) / order.length);

/** Horizontal position of each stretch as fractions of the session: [start, stop], at least a hair wide. */
export function spanFractions(
  spans: [number, number][],
  t0: number,
  t1: number,
): [number, number][] {
  const total = t1 - t0;
  if (!(total > 0)) return [];
  return spans.map(([a, b]) => {
    const x0 = Math.min(1, Math.max(0, (a - t0) / total));
    const x1 = Math.min(1, Math.max(0, (b - t0) / total));
    return [x0, Math.max(x1, x0 + 0.002)];
  });
}

/** "cells 3, 8 and 12", shortened to the first few with a count of the rest. */
export function cellsLabel(cells: number[], show = 6): string {
  const one = cells.map((c) => c + 1);
  const head = one.slice(0, show).join(', ');
  const rest = one.length - show;
  return `${one.length === 1 ? 'cell' : 'cells'} ${head}${rest > 0 ? ` and ${rest} more` : ''}`;
}

/** Footprint centre (x, y) of each cell, from its brightest pixels, for a marker over the map. */
export function footprintCentres(
  data: ArrayLike<number>,
  cells: number,
  height: number,
  width: number,
): [number, number][] {
  const n = height * width;
  return Array.from({ length: cells }, (_, c) => {
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, data[c * n + i]);
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let i = 0; i < n; i++) {
      const v = data[c * n + i];
      if (v < peak / 2) continue;
      sx += v * (i % width);
      sy += v * Math.floor(i / width);
      sw += v;
    }
    return sw ? [sx / sw + 0.5, sy / sw + 0.5] : [NaN, NaN];
  });
}
