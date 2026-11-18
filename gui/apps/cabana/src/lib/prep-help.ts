// Tooltip text for the Preprocess settings. Keep it in step with the code (framework.ts, prepared.ts).

/** Short parameter definitions for tooltips: what the number is, its unit, its immediate effect. */
export const PARAM_TIP = {
  maxGapS:
    'Longest spacing between tracked camera samples that is interpolated across, in seconds. Neural frames in a longer gap have no position.',
  speedWindowS:
    'Time between the two frames compared, in seconds. Rounded to whole frames, at least one.',
  eventSigmaS: 'Standard deviation of the Gaussian, in seconds. 0 leaves events unchanged.',
  traceSigmaS: 'Standard deviation of the Gaussian, in seconds. 0 leaves traces unchanged.',
  fillGapS:
    'Longest run of missing frames that is filled, in seconds. Rounded down to whole frames. Runs at the session start or end are never filled.',
  posMethod: 'Median keeps sharp turns and removes single-frame jumps. Gaussian blurs them.',
  posWindowS: 'Full window width, in seconds, rounded to an odd number of frames.',
  labelPadS: 'Time added before and after every bout, in seconds. Rounded to whole frames.',
} as const;
