// Preprocessing settings, one per framework step (functions in framework.ts).

import { createStore } from 'solid-js/store';

/**
 * Starting points. Each is one framework step (named in the comment); a value of 0 leaves the step out.
 * Every one can be changed on the Preprocess step.
 */
export const DEFAULT_PREP = {
  /** smooth_activity on deconvolved events: Gaussian width (s). */
  eventSigmaS: 0,
  /** smooth_activity on raw and denoised traces: Gaussian width (s). */
  traceSigmaS: 0,
  /** smooth_signal on position: filter, and the full window width (s). */
  posMethod: 'median' as 'median' | 'gaussian',
  posWindowS: 0.25,
  /** speed: window (s) of the finite difference. */
  speedWindowS: 0.25,
  /** speed_threshold: frames with speed below this (cm/s) are left out. */
  minSpeed: 2,
  /** clean_mask dilate_s: each behavior bout is widened by this many seconds on both sides. */
  labelPadS: 0,
};
export const [prep, setPrep] = createStore({ ...DEFAULT_PREP });
