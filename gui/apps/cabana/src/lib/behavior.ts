// Checks on annotated behavior: epochs with a label, a start and a stop.
// Annotation problems can only be fixed in the annotation file, so these
// checks explain what to change there.

import { column, type Table } from './parse.ts';
import { failIfOver, type Check } from './qc.ts';

export interface Epoch {
  label: string;
  start: number;
  stop: number;
  /** Errors: the epoch is wrong as written. Count against the allowed percent. */
  flags: string[];
  /** Advice only: not counted as a problem. */
  notes: string[];
}

export function readEpochs(t: Table): Epoch[] {
  const i = t.columns.findIndex((c) => c.toLowerCase().includes('label'));
  if (i < 0) throw new Error(`No "label" column. Found: ${t.columns.join(', ')}.`);
  const start = column(t, 'start');
  const stop = column(t, 'stop');
  return t.rows.map((r, k) => ({
    label: r[i],
    start: start[k],
    stop: stop[k],
    flags: [],
    notes: [],
  }));
}

export interface LabelStats {
  label: string;
  n: number;
  /** Mean and SD of epoch length (s). */
  meanLen: number;
  sdLen: number;
  /** Mean time (s) from the end of one epoch to the start of the next. NaN with fewer than two epochs. */
  meanGap: number;
  /** Percent of the session the label covers. */
  pctSession: number;
}

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
const sd = (v: number[]) => Math.sqrt(mean(v.map((x) => (x - mean(v)) ** 2)));

function gaps(sorted: Epoch[]): number[] {
  return sorted
    .slice(1)
    .map((e, i) => e.start - sorted[i].stop)
    .filter((g) => g >= 0);
}

/** One row per label, then one for all labels together (gaps between consecutive epochs of any label). */
export function annotationStats(epochs: Epoch[], duration: number): LabelStats[] {
  const row = (label: string, own: Epoch[]): LabelStats => {
    const sorted = own.filter((e) => e.stop > e.start).sort((a, b) => a.start - b.start);
    const len = sorted.map((e) => e.stop - e.start);
    return {
      label,
      n: sorted.length,
      meanLen: mean(len),
      sdLen: sd(len),
      meanGap: mean(gaps(sorted)),
      pctSession: (100 * len.reduce((a, b) => a + b, 0)) / duration,
    };
  };
  const labels = [...new Set(epochs.map((e) => e.label))];
  return [
    ...labels.map((l) =>
      row(
        l,
        epochs.filter((e) => e.label === l),
      ),
    ),
    row('All labels', epochs),
  ];
}

/** `merge_gap_s`: bouts of the same label that overlap or are less than `gap` seconds apart become one bout. */
export function mergeBouts(epochs: Epoch[], gap: number): { epochs: Epoch[]; merged: number } {
  const out: Epoch[] = [];
  let merged = 0;
  for (const label of new Set(epochs.map((e) => e.label))) {
    const own = epochs.filter((e) => e.label === label).sort((a, b) => a.start - b.start);
    let cur: Epoch | undefined;
    for (const e of own) {
      if (cur && e.start - cur.stop < gap) {
        cur.stop = Math.max(cur.stop, e.stop);
        merged++;
      } else {
        if (cur) out.push(cur);
        cur = { label, start: e.start, stop: e.stop, flags: [], notes: [] };
      }
    }
    if (cur) out.push(cur);
  }
  return { epochs: out.sort((a, b) => a.start - b.start), merged };
}

/** `min_duration_s`: drop bouts shorter than `min` seconds. */
export function dropShortBouts(epochs: Epoch[], min: number): { epochs: Epoch[]; removed: number } {
  const keep = epochs.filter((e) => e.stop - e.start >= min);
  return { epochs: keep, removed: epochs.length - keep.length };
}

export interface AnnotationTol {
  annotPct: number;
  /** Bouts shorter than this many seconds are flagged. */
  minBoutS: number;
  /** Bouts of one label closer than this many seconds are flagged as one bout split in two. */
  mergeGapS: number;
}

/** Marks problem epochs in place and returns the checks. `duration` is the session length in seconds. */
export function annotationQc(epochs: Epoch[], duration: number, tol: AnnotationTol): Check[] {
  const labels = [...new Set(epochs.map((e) => e.label))];
  for (const e of epochs) {
    e.flags = [];
    e.notes = [];
    if (!(e.stop > e.start)) e.flags.push('stop is not after start');
    else if (e.stop - e.start < tol.minBoutS) e.notes.push(`under ${tol.minBoutS} s`);
    if (e.start < -0.1 || e.stop > duration + 0.1) e.flags.push('outside the session');
  }
  let close = 0;
  for (const l of labels) {
    const own = epochs.filter((e) => e.label === l).sort((a, b) => a.start - b.start);
    let reach = -Infinity;
    own.forEach((e, i) => {
      if (i > 0 && e.start - reach < tol.mergeGapS) {
        const gap = e.start - reach;
        own[i - 1].notes.push(
          gap < 0
            ? `overlaps the next ${l} bout: same bout?`
            : `only ${gap.toFixed(2)} s before the next ${l} bout: same bout?`,
        );
        close++;
      }
      reach = Math.max(reach, e.stop);
    });
  }
  const n = epochs.length;
  const count = (f: string) => epochs.filter((e) => e.flags.some((x) => x.startsWith(f))).length;
  const short = epochs.filter((e) => e.notes.some((x) => x.startsWith('under'))).length;
  const few = labels.filter((l) => epochs.filter((e) => e.label === l).length < 5);
  const bad = epochs.filter((e) => e.flags.length).length;
  const error = (id: string, title: string, k: number, what: string, fix: string): Check => ({
    id,
    group: 'Behavior',
    title,
    status: k === 0 ? 'pass' : 'warn',
    value: k ? `${k} of ${n}` : 'None found',
    detail:
      k === 0
        ? 'None found.'
        : `${k} of ${n} epochs ${what}. They are outlined in red below and count toward the allowed percent of epochs with an error.`,
    fix,
  });
  return [
    {
      id: 'ann-total',
      group: 'Behavior',
      title: 'Epochs with an error',
      status: failIfOver((100 * bad) / Math.max(n, 1), tol.annotPct),
      value: `${bad} of ${n}`,
      limit: `allow ${tol.annotPct}%`,
      detail: `${bad} of ${n} epochs (${((100 * bad) / Math.max(n, 1)).toFixed(1)}%) have a start and stop that cannot be right (allowed: ${tol.annotPct}%).`,
    },
    error(
      'ann-times',
      'Start and stop times',
      count('stop is not'),
      'end before they start',
      'Correct these rows in the annotation file, then reload it.',
    ),
    error(
      'ann-range',
      'Epochs inside the session',
      count('outside'),
      `fall outside the ${duration.toFixed(0)} s session`,
      'Check the annotation times against the video: they may use a different clock or start point. Correct the file and reload it.',
    ),
    {
      id: 'ann-merge',
      group: 'Behavior',
      title: `Bouts of one label closer than ${tol.mergeGapS} s`,
      status: close ? 'warn' : 'pass',
      value: close ? `${close} pairs` : 'None found',
      detail: close
        ? `${close} pairs of bouts with the same label overlap or are less than ${tol.mergeGapS} s apart. These are most likely one bout split by a pause in scoring. They are outlined in amber below.`
        : 'None found.',
      fix: 'Merge them with the button below, or fix the annotation file. Optional.',
    },
    {
      id: 'ann-short',
      group: 'Behavior',
      title: `Bouts under ${tol.minBoutS} s`,
      status: short ? 'warn' : 'pass',
      value: short ? `${short} bouts` : 'None found',
      detail: short
        ? `${short} bouts are shorter than ${tol.minBoutS} s. A bout that short covers only a few frames, so a slip of a frame or two in scoring is a large share of it, and neural responses to it are hard to tell from noise. Some behaviors really are brief, so check before removing.`
        : 'None found.',
      fix: 'Remove them with the button below if they are slips. Optional.',
    },
    {
      id: 'ann-few',
      group: 'Behavior',
      title: 'Epochs per label',
      status: few.length ? 'warn' : 'pass',
      detail: few.length
        ? `Fewer than 5 epochs: ${few.join(', ')}. That is too few for most analyses.`
        : 'Every label has at least 5 epochs.',
      fix: 'Annotate more of the session, or leave that label out of the analysis.',
    },
  ];
}
