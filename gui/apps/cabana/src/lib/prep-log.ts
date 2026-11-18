// Records preprocessing setting changes in the Changes history. Settings change as a field is typed
// or a slider moves, so a change is logged once the step's values have been still for a second.
// Clearing the session resets the baseline without logging.

import { createEffect, createRoot, on } from 'solid-js';
import { logChange } from './changes-log.ts';
import { STEPS, type PrepKey, type StepId } from './prep-deps.ts';
import { DEFAULT_PREP, prep } from './preprocess.ts';
import { onClear } from './store.ts';

const UNIT: Partial<Record<PrepKey, string>> = { minSpeed: 'cm/s', posMethod: '' };

/** One setting's value in words: "0.5 s", "2 cm/s", "median", or "off" for an optional step at 0. */
export function valueText(k: PrepKey, v: number | string): string {
  if (typeof v === 'string') return v;
  if (v === 0 && k !== 'minSpeed' && k !== 'maxGapS') return 'off';
  return `${v} ${UNIT[k] ?? 's'}`;
}

/** The values a step reads, in words. */
export const stepValues = (step: StepId, p: typeof DEFAULT_PREP): string =>
  STEPS[step].keys.map((k) => valueText(k, p[k])).join(', ');

let baseline = { ...DEFAULT_PREP };
let timer: ReturnType<typeof setTimeout> | undefined;

function flush(): void {
  timer = undefined;
  const now = { ...prep };
  for (const [id, s] of Object.entries(STEPS) as [StepId, (typeof STEPS)[StepId]][]) {
    if (!s.keys.some((k) => now[k] !== baseline[k])) continue;
    logChange(
      'change',
      'prep',
      `${s.label}: ${stepValues(id, baseline)} to ${stepValues(id, now)}`,
    );
  }
  baseline = now;
}

onClear(() => {
  clearTimeout(timer);
  timer = undefined;
  baseline = { ...DEFAULT_PREP };
});

createRoot(() =>
  createEffect(
    on(
      () => (Object.keys(DEFAULT_PREP) as PrepKey[]).map((k) => prep[k]),
      () => {
        clearTimeout(timer);
        timer = setTimeout(flush, 1000);
      },
      { defer: true },
    ),
  ),
);
