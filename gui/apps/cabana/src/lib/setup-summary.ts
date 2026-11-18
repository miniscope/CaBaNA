// The Experimental summary card of the Data setup page: one value per field, in words, from what
// the store knows. Pure formatting, so the page and the tests agree.

import type { Tone } from './setup-rows.ts';

const number = (v: number, digits = 1) => String(Math.round(v * 10 ** digits) / 10 ** digits);

export const rateText = (hz: number | undefined): string =>
  hz !== undefined && Number.isFinite(hz) ? `${number(hz)} Hz` : 'Not known';

export const durationText = (seconds: number | undefined): string =>
  seconds !== undefined && Number.isFinite(seconds) ? `${number(seconds / 60)} min` : 'Not known';

export function arenaText(
  shape: 'rectangle' | 'circle',
  width: number,
  height: number,
  zones: number,
): string {
  const size =
    shape === 'circle' ? `${number(width)} cm across` : `${number(width)} × ${number(height)} cm`;
  return `${size}, ${zones} ${zones === 1 ? 'zone' : 'zones'}`;
}

/** The timestamp alignment checks in words: failed first, then flagged, else the passed count. */
export function alignmentText(statuses: string[]): { text: string; tone: Tone } {
  if (!statuses.length) return { text: 'Runs once timestamp files load', tone: 'muted' };
  const n = (s: string) => statuses.filter((x) => x === s).length;
  const word = (k: number, w: string) => `${k} ${k === 1 ? 'check' : 'checks'} ${w}`;
  if (n('fail')) return { text: word(n('fail'), 'failed'), tone: 'fail' };
  if (n('warn')) return { text: word(n('warn'), 'flagged'), tone: 'warn' };
  return { text: word(n('pass'), 'passed'), tone: 'ok' };
}
