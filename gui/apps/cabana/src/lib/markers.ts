// Time markers: occurrences represented by a single time (tone onset, TTL edge, lick detection).
// CSV `label,time_s`, in seconds on the session clock, the same clock as epoch files.

import { parseCsvText } from './csv-text.ts';

export interface Marker {
  label: string;
  timeS: number;
}

export interface MarkerFile {
  markers: Marker[];
  /** Why the file cannot be used or what was left out. */
  problems: string[];
  ignoredColumns: string[];
  /** Rows dropped for a missing label or a time that is not a finite number. */
  rejected: number;
}

const findColumn = (columns: string[], name: string) =>
  columns.findIndex((c) => c.toLowerCase() === name);

export function readMarkers(text: string): MarkerFile {
  const { columns, rows } = parseCsvText(text);
  const label = findColumn(columns, 'label');
  const time = findColumn(columns, 'time_s');
  const problems: string[] = [];
  if (label < 0) problems.push('No "label" column.');
  if (time < 0) problems.push('No "time_s" column (time in seconds).');
  if (problems.length) {
    problems.push(`Found: ${columns.join(', ') || 'no header'}.`);
    return { markers: [], problems, ignoredColumns: [], rejected: 0 };
  }

  const ignoredColumns = columns.filter((_, i) => i !== label && i !== time);
  const markers: Marker[] = [];
  let rejected = 0;
  for (const r of rows) {
    const name = (r[label] ?? '').trim();
    const raw = (r[time] ?? '').trim();
    const timeS = raw === '' ? NaN : Number(raw);
    if (name && Number.isFinite(timeS)) markers.push({ label: name, timeS });
    else rejected++;
  }
  if (rejected)
    problems.push(`${rejected} row(s) rejected: missing label or time is not a number.`);
  if (ignoredColumns.length) problems.push(`Ignored columns: ${ignoredColumns.join(', ')}.`);
  return { markers, problems, ignoredColumns, rejected };
}

/** Markers outside the neural time span [t0, t1]. They are kept but drawn nowhere. */
export function outsideRecording(markers: Marker[], t0: number, t1: number): Marker[] {
  return markers.filter((m) => m.timeS < t0 || m.timeS > t1);
}

/** One entry per label for the label registry, with a note when some of its markers are outside the recording. */
export function markerLabelCounts(markers: Marker[], span?: [number, number]) {
  const counts = new Map<string, { count: number; outside: number }>();
  const outside = new Set(span ? outsideRecording(markers, span[0], span[1]) : []);
  for (const m of markers) {
    const c = counts.get(m.label) ?? { count: 0, outside: 0 };
    c.count++;
    if (outside.has(m)) c.outside++;
    counts.set(m.label, c);
  }
  return [...counts].map(([name, { count, outside: n }]) => ({
    name,
    count,
    problems: n ? [`${n} outside recording`] : [],
  }));
}
