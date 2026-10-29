// Text for the Preprocess help drawer and tooltips. "What it does", "Default" and parameter
// definitions describe the code (framework.ts / prepared.ts, ports of the framework-demo
// functions named in each comment); "Consider it when", "Leave it off when" and "How to adjust"
// are conditional guidance, not something the code establishes. Keep both in step with the code.

import type { StepId } from './prep-deps.ts';

export interface StepHelp {
  /** One sentence under the step title. */
  short: string;
  what: string;
  why?: string;
  leaveOff?: string;
  adjust: string;
  tradeoffs: string;
  default: string;
}

export const STEP_HELP: Partial<Record<StepId, StepHelp>> = {
  // resample_signal (linear), max_gap_s
  positionOnFrames: {
    short: 'Places position on the neural frames, the clock every analysis uses.',
    what:
      'Position is interpolated linearly from the camera times onto each neural frame time. A neural frame has no position when it falls outside the camera recording, when the nearest camera sample was itself missing, or when it lies between two tracked samples further apart than the limit.',
    adjust:
      'The limit mostly matters for camera frames missing from the timestamps. Raising it interpolates across longer camera gaps; lowering it leaves more frames without position. Dropouts in the position file stay missing whatever the limit; Fill tracking gaps handles those.',
    tradeoffs: 'Frames without position are left out of place maps, and out of auROC when its speed filter is on.',
    default: '0.5 s, the framework default for position (max_gap_s).',
  },
  // speed: centered difference over w = round(window * fs) frames
  speed: {
    short: 'Speed from the distance moved between frames one window apart.',
    what:
      'For each frame, the distance between two frames one window apart, centered on it as nearly as whole frames allow, divided by the time between them. It is not an average over the window. Near the session edges the pair shifts inward. Speed is missing when either of the two frames has no position. It uses position after gap filling and smoothing.',
    adjust:
      'A longer window gives a steadier speed that responds later to starts and stops. A shorter one follows quick changes but picks up tracking jitter. Compare the trace with the position plot.',
    tradeoffs: 'Changes which frames pass the speed filter.',
    default: '0.25 s, the framework default (window_s).',
  },
  // bouts_to_states
  boutLabels: {
    short: 'Turns scored bouts into one label per neural frame.',
    what:
      'A frame is in a bout from the first neural frame at or after the bout start up to, but not including, the first frame at or after its stop. Each behavior gets its own labels, so a frame can carry two behaviors when their bouts overlap.',
    adjust: 'Nothing to set. Bout padding widens the labels afterwards.',
    tradeoffs: 'A bout shorter than one frame interval can end up with no frames.',
    default: 'No setting.',
  },
  // smooth_activity: gaussian_filter1d, sigma = sigma_s * fs, truncate 4, mode nearest
  eventSmooth: {
    short: 'Spreads each deconvolved event over neighboring frames.',
    what:
      'Each cell’s deconvolved events are smoothed along time with a Gaussian. The value is the Gaussian’s standard deviation in seconds; the kernel reaches 4 standard deviations either side, and at the session edges the nearest value is repeated. The total of each event is kept, and its peak is lowered. 0 leaves events as they are.',
    why:
      'Consider it when labels or position may be a frame or two off relative to the events, so an event can miss the frame it belongs to.',
    leaveOff:
      'Leave it off when timing at the scale of a few frames matters, or when labels and events are already well aligned. Smoothing does not add information.',
    adjust:
      'A larger value moves each event’s weight further in time, about two standard deviations either side, so events near a bout edge or a bin border are shared with the neighbor. Compare the smoothed trace with the events around a known transition.',
    tradeoffs:
      'Blurs event timing and lowers peaks. Activity just before or after a behavior can be counted during it. Place cells, auROC and PETH all use the smoothed events.',
    default: '0 (off). A software default, not a recommendation.',
  },
  // interpolate_gaps (linear), max_gap_s, after resample_signal
  fillGaps: {
    short: 'Fills short runs of missing position with a straight line.',
    what:
      'After position is on the neural frames, each run of missing frames up to the limit is filled with a straight line between the frames on either side. The limit is rounded down to whole frames. Longer runs, and runs touching the session start or end, stay missing. 0 turns it off.',
    why:
      'Consider it when short dropouts interrupt an otherwise plausible path, so those frames would otherwise be left out.',
    leaveOff:
      'Leave it off when tracking is complete, or when dropouts happen during fast or curved movement where a straight line misplaces the animal.',
    adjust:
      'Raising the limit keeps more frames but guesses over longer stretches. Lowering it guesses less and leaves more frames missing. Check that each filled segment joins the path on both sides without crossing a wall.',
    tradeoffs:
      'Filled frames are estimates. Speed across a filled run is nearly constant, so the run tends to pass or fail the speed filter as a block. Position smoothing and speed use the filled frames.',
    default: '0.5 s, the framework default (max_gap_s). Not a recommendation for every dataset.',
  },
  // smooth_signal: window = full width, odd frames; gaussian sigma = window / 4; NaN stays NaN
  posSmooth: {
    short: 'Smooths position to reduce tracking jitter.',
    what:
      'Each frame takes the median, or a Gaussian-weighted mean, of the tracked frames in a window centered on it. The value is the full window width in seconds, rounded to an odd number of frames; for the Gaussian the standard deviation is a quarter of the window. Missing frames stay missing and are not used.',
    why:
      'Consider it when tracking jitter makes a still animal look like it is moving, which inflates speed. A median removes single-frame jumps and keeps sharp turns; a Gaussian blurs them.',
    leaveOff: 'Leave it off when tracking is already clean, or when brief, fast movements matter.',
    adjust:
      'A wider window removes more jitter and rounds off turns and fast starts. Compare the speed trace before and after: smoothing should lower speed during stillness without flattening real movement.',
    tradeoffs: 'Changes position bins and speed, so it changes which frames pass the speed filter.',
    default: 'Median, 0.25 s, the framework defaults (method, window_s).',
  },
  // clean_mask dilate_s, per behavior
  boutPad: {
    short: 'Widens each scored bout by the same time on both sides.',
    what:
      'Each behavior’s frame labels grow by the value on each side, rounded to whole frames. Each behavior is widened separately, so overlapping labels stay overlapping: a frame can belong to two behaviors. The frames counted as outside a behavior shrink by the same amount. 0 turns it off.',
    why: 'Consider it when bout starts and stops were scored loosely, or by a few frames off.',
    leaveOff:
      'Leave it off when bouts were scored at frame precision, when behaviors follow each other closely, or when the question is about activity just before or after a behavior.',
    adjust:
      'A larger value counts more frames as during the behavior. Look at the label rows: widened bouts should cover the scored edges without merging into neighboring bouts of other behaviors.',
    tradeoffs:
      'Activity just before and after a behavior is counted during it, which blurs onset and offset timing. Close bouts of different behaviors can share frames. Only auROC uses the padded labels; PETH takes onsets from the unpadded labels.',
    default: '0 (off). A software default, not a recommendation.',
  },
};

/** Short parameter definitions for tooltips: what the number is, its unit, its immediate effect. */
export const PARAM_TIP = {
  maxGapS:
    'Longest spacing between tracked camera samples that is interpolated across, in seconds. Neural frames in a longer gap have no position.',
  speedWindowS:
    'Time between the two frames compared, in seconds. Rounded to whole frames, at least one.',
  eventSigmaS: 'Standard deviation of the Gaussian, in seconds. 0 leaves events unchanged.',
  fillGapS:
    'Longest run of missing frames that is filled, in seconds. Rounded down to whole frames. Runs at the session start or end are never filled.',
  posMethod: 'Median keeps sharp turns and removes single-frame jumps. Gaussian blurs them.',
  posWindowS: 'Full window width, in seconds, rounded to an odd number of frames.',
  labelPadS: 'Time added before and after every bout, in seconds. Rounded to whole frames.',
} as const;
