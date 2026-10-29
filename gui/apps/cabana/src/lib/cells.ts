// A score for each cell from three checks: signal to noise, correlation with
// neighboring cells, and how many events it has. Stand-in for `cabana`, like qc.ts.

import type { Matrix } from './parse.ts';
import { failIfOver, type Check } from './qc.ts';

export type Level = 'good' | 'warn' | 'bad';
export interface CellScore {
  snr: number;
  snrLevel: Level;
  /** Highest correlation with a neighbor; -1 when the cell has none. */
  corr: number;
  corrLevel: Level;
  /** Fraction of frames with an event; NaN when there are no events. */
  frac: number;
  eventLevel: Level;
  overall: Level;
  notes: string[];
  /** Rejected by the user: left out of the counts below and of later analysis. */
  rejected: boolean;
}

/** Cells whose footprint centres are closer than this (pixels) count as neighbors. */
export const NEIGHBOR_PX = 20;

const worst = (...l: Level[]): Level =>
  l.includes('bad') ? 'bad' : l.includes('warn') ? 'warn' : 'good';

export function eventFractions(m: Matrix): number[] {
  return Array.from({ length: m.cells }, (_, c) => {
    let n = 0;
    for (let i = c * m.frames; i < (c + 1) * m.frames; i++) if (m.data[i] > 0) n++;
    return n / m.frames;
  });
}

export function scoreCells(
  snr: number[],
  corr: number[],
  frac: number[] | undefined,
  rejected: ReadonlySet<number>,
): CellScore[] {
  return snr.map((s, c) => {
    const notes: string[] = [];
    const snrLevel: Level = s < 3 ? 'bad' : s < 5 ? 'warn' : 'good';
    if (snrLevel !== 'good') notes.push('noisy');
    const corrLevel: Level = corr[c] > 0.8 ? 'bad' : corr[c] > 0.6 ? 'warn' : 'good';
    if (corrLevel !== 'good') notes.push('correlated with a neighbor');
    const f = frac ? frac[c] : NaN;
    let eventLevel: Level = 'good';
    if (f === 0) eventLevel = 'bad';
    else if (f > 0.5) eventLevel = 'bad';
    else if (f > 0.25) eventLevel = 'warn';
    if (f === 0) notes.push('no events');
    else if (f > 0.5) notes.push('events on over half of frames');
    else if (f > 0.25) notes.push('dense events');
    return {
      rejected: rejected.has(c),
      snr: s,
      snrLevel,
      corr: corr[c],
      corrLevel,
      frac: f,
      eventLevel,
      overall: worst(snrLevel, corrLevel, eventLevel),
      notes,
    };
  });
}

export function cellChecks(
  all: CellScore[],
  hasFootprints: boolean,
  tol: { poorCellPct: number },
): Check[] {
  const scores = all.filter((s) => !s.rejected);
  const n = scores.length;
  if (!n) return [];
  const count = (key: 'snrLevel' | 'corrLevel' | 'eventLevel', l: Level) =>
    scores.filter((s) => s[key] === l).length;
  const pct = (k: number) => (100 * k) / n;
  const med = (v: number[]) => v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)];
  const allowed = `allowed: ${tol.poorCellPct}% of cells`;
  const checks: Check[] = [
    {
      id: 'snr',
      group: 'Neural',
      title: 'Signal to noise',
      status: failIfOver(pct(count('snrLevel', 'bad')), tol.poorCellPct),
      value: `median ${med(scores.map((s) => s.snr)).toFixed(1)}`,
      limit: `${count('snrLevel', 'bad')} of ${n} below 3`,
      detail: `Median ${med(scores.map((s) => s.snr)).toFixed(1)}. ${count('snrLevel', 'bad')} of ${n} cells (${pct(count('snrLevel', 'bad')).toFixed(1)}%) are below 3 (${allowed}); ${count('snrLevel', 'warn')} more are between 3 and 5.`,
      fix: 'Reject the noisy cells below, or re-run source extraction with stricter acceptance criteria.',
    },
    {
      id: 'corr',
      group: 'Neural',
      title: hasFootprints ? 'Correlation with neighboring cells' : 'Correlation between cells',
      status: failIfOver(pct(count('corrLevel', 'bad')), tol.poorCellPct),
      value: `${count('corrLevel', 'bad')} of ${n} cells`,
      limit: `allow ${tol.poorCellPct}%`,
      detail:
        `${count('corrLevel', 'bad')} of ${n} cells (${pct(count('corrLevel', 'bad')).toFixed(1)}%) correlate above 0.8 with ${hasFootprints ? 'a neighbor' : 'another cell'} (${allowed}); ${count('corrLevel', 'warn')} more are between 0.6 and 0.8.` +
        (hasFootprints
          ? ` Neighbors are cells with centers within ${NEIGHBOR_PX} px.`
          : ' Without footprints every pair counts, not only neighbors.'),
      fix: 'Reject one cell of each correlated pair, or merge duplicates in your source extraction and re-export.',
    },
  ];
  if (!Number.isNaN(scores[0].frac)) {
    const none = scores.filter((s) => s.frac === 0).length;
    const dense = scores.filter((s) => s.frac > 0.25).length;
    const poor = scores.filter((s) => s.eventLevel === 'bad').length;
    checks.push({
      id: 'events',
      group: 'Events',
      title: 'Number of events per cell',
      status: failIfOver(pct(poor), tol.poorCellPct),
      value: `${poor} of ${n} cells`,
      limit: `allow ${tol.poorCellPct}%`,
      detail: `A typical cell has an event in ${(100 * med(scores.map((s) => s.frac))).toFixed(1)}% of frames. ${none} cells have none and ${dense} have them on over 25% of frames, which usually means noise is being fitted. ${poor} cells (${pct(poor).toFixed(1)}%) have none or events on over half of frames (${allowed}).`,
      fix: 'Reject the cells below, or re-run deconvolution with a higher noise threshold or sparsity penalty.',
    });
  }
  return checks;
}
