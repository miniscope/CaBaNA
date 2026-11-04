// Counts for the Preprocess preview summary. They compare position and speed as put on the neural
// frames (before) with the same after gap filling and position smoothing (after). Nothing here
// judges whether the change is an improvement.

export interface PositionStages {
  /** x and y on the neural frames, before gap filling. */
  rx: ArrayLike<number>;
  ry: ArrayLike<number>;
  /** After gap filling. */
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  /** After gap filling and position smoothing. */
  sx: ArrayLike<number>;
  sy: ArrayLike<number>;
  /** Speed from x, y (before smoothing) and from sx, sy (after), in cm/s. */
  speedBefore: ArrayLike<number>;
  speedAfter: ArrayLike<number>;
}

export interface PrepSummary {
  frames: number;
  /** Frames that had no position before gap filling and have one after it. */
  framesFilled: number;
  validBefore: number;
  validAfter: number;
  /** Largest speed (cm/s), or undefined when no frame has a speed. */
  peakSpeedBefore: number | undefined;
  peakSpeedAfter: number | undefined;
}

const hasValue = (a: ArrayLike<number>, b: ArrayLike<number>, i: number) =>
  Number.isFinite(a[i] + b[i]);

function peak(v: ArrayLike<number>): number | undefined {
  let best: number | undefined;
  for (let i = 0; i < v.length; i++)
    if (Number.isFinite(v[i]) && (best === undefined || v[i] > best)) best = v[i];
  return best;
}

export function prepSummary(p: PositionStages): PrepSummary {
  let framesFilled = 0;
  let validBefore = 0;
  let validAfter = 0;
  for (let i = 0; i < p.rx.length; i++) {
    if (hasValue(p.rx, p.ry, i)) validBefore++;
    else if (hasValue(p.x, p.y, i)) framesFilled++;
    if (hasValue(p.sx, p.sy, i)) validAfter++;
  }
  return {
    frames: p.rx.length,
    framesFilled,
    validBefore,
    validAfter,
    peakSpeedBefore: peak(p.speedBefore),
    peakSpeedAfter: peak(p.speedAfter),
  };
}
