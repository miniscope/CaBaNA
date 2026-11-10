// The one-line QC status of a test on the Data setup page: its result, how many checks ran, and
// whether the user has reviewed it. Kept apart from the computed result on purpose: "passed" and
// "reviewed" are different states.

import type { Status } from './qc.ts';

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

export function qcStatusText(checks: { status: Status }[], reviewed: boolean): string {
  if (!checks.length) return 'Nothing to check yet';
  const fails = checks.filter((c) => c.status === 'fail').length;
  const notes = checks.filter((c) => c.status === 'warn').length;
  const result = fails
    ? `Failed ${plural(fails, 'check')}${notes ? ` · ${plural(notes, 'note')}` : ''}`
    : notes
      ? `Passed with ${plural(notes, 'note')}`
      : 'Passed';
  return [result, plural(checks.length, 'check'), reviewed ? 'reviewed' : 'not reviewed yet'].join(
    ' · ',
  );
}
