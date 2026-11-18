export interface SessionFacts {
  name?: string;
  task?: string;
  cells?: number;
  frames?: number;
  hz?: number;
  minutes?: number;
}

/** The header's data line: only the parts that are known, or a note when nothing is open. */
export function headerLine(f: SessionFacts | undefined): string {
  if (!f) return 'No session open';
  const parts = [
    f.name,
    f.task,
    f.cells !== undefined && `${f.cells.toLocaleString('en-US')} cells`,
    f.frames !== undefined && `${f.frames.toLocaleString('en-US')} fr`,
    f.hz !== undefined && Number.isFinite(f.hz) && `${Math.round(f.hz * 10) / 10} Hz`,
    f.minutes !== undefined && Number.isFinite(f.minutes) && `${f.minutes.toFixed(1)} min`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No session open';
}
