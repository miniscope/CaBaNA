// The time window shared by the plots in the Data visualization step.

import { createMemo, createSignal } from 'solid-js';
import { cameraTimes, frameTimes } from './store.ts';

/** First and last time of the session, in seconds. */
export const span = createMemo<[number, number]>(() => {
  const n = frameTimes();
  const c = cameraTimes()?.filter(Number.isFinite);
  const times = [
    ...(n ? [n[0], n[n.length - 1]] : []),
    ...(c?.length ? [c[0], c[c.length - 1]] : []),
  ];
  return times.length ? [Math.min(...times), Math.max(...times)] : [0, 1];
});

export const WINDOW_CHOICES = [
  { label: '10 s', s: 10 },
  { label: '30 s', s: 30 },
  { label: '1 min', s: 60 },
  { label: '5 min', s: 300 },
  { label: 'Whole session', s: Infinity },
];

const [winLen, setWinLen] = createSignal(60);
const [winStart, setWinStart] = createSignal(0);
export { winLen, setWinLen };

/** The visible window [start, end] in seconds. */
export const win = createMemo<[number, number]>(() => {
  const [t0, t1] = span();
  const len = Math.min(winLen(), t1 - t0);
  const start = Math.min(Math.max(winStart(), t0), t1 - len);
  return [start, start + len];
});
export const setWinStartClamped = (s: number) => setWinStart(s);

/** A time under the mouse in the session plots. */
export const [hoverT, setHoverT] = createSignal<number | undefined>();
