// Browser versions of the functions in the CaBaNA framework (miniscope/CaBaNA,
// branch framework-demo). Each one follows the Python function named in its
// comment: same rule, same defaults, same edge handling. When the Python package
// runs in the browser these are replaced by calls to it.

/** Python's round(): halves go to the even number. */
const pyRound = (x: number) => {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

/** First index whose value is not before x. */
export function lowerBound(t: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose value is after x. */
function upperBound(t: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** `_odd_frames`: a window in seconds as an odd number of frames, at least 1. */
export function oddFrames(windowS: number, fs: number): number {
  const w = Math.max(1, pyRound(windowS * fs));
  return w % 2 ? w : w + 1;
}

/**
 * `interpolate_gaps` (linear): fill runs of NaN of at most `maxGapS`. A run at the start or end of the signal has
 * a neighbor on one side only and is never filled.
 */
export function interpolateGaps(
  v: ArrayLike<number>,
  fs: number,
  maxGapS: number,
): { out: Float64Array; filled: number } {
  const out = Float64Array.from(v);
  const maxFrames = Math.floor(maxGapS * fs + 1e-9);
  const n = v.length;
  let filled = 0;
  for (let a = 0; a < n;) {
    if (!Number.isNaN(v[a])) {
      a++;
      continue;
    }
    let b = a;
    while (b < n && Number.isNaN(v[b])) b++;
    const ln = b - a;
    if (ln <= maxFrames && a > 0 && b < n) {
      for (let k = 1; k <= ln; k++) out[a + k - 1] = v[a - 1] + ((v[b] - v[a - 1]) * k) / (ln + 1);
      filled += ln;
    }
    a = b;
  }
  return { out, filled };
}

const nanMedian = (w: number[]) => {
  if (!w.length) return NaN;
  w.sort((p, q) => p - q);
  const m = w.length >> 1;
  return w.length % 2 ? w[m] : (w[m - 1] + w[m]) / 2;
};

/**
 * `smooth_signal` (median or gaussian): `windowS` is the full window width. Only finite frames count, and frames
 * that are NaN stay NaN. The gaussian has sigma = window / 4.
 */
export function smoothSignal(
  v: ArrayLike<number>,
  fs: number,
  method: 'median' | 'gaussian',
  windowS: number,
): Float64Array {
  const n = v.length;
  const w = oddFrames(windowS, fs);
  const fin = Array.from({ length: n }, (_, i) => Number.isFinite(v[i]));
  if (w === 1 || !fin.some(Boolean)) return Float64Array.from(v);
  const half = w >> 1;
  const out = new Float64Array(n);
  const sigma = w / 4;
  for (let i = 0; i < n; i++) {
    if (!fin[i]) {
      out[i] = NaN;
      continue;
    }
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    if (method === 'median') {
      const win: number[] = [];
      for (let k = lo; k <= hi; k++) if (fin[k]) win.push(v[k]);
      out[i] = nanMedian(win);
    } else {
      let num = 0;
      let den = 0;
      for (let k = lo; k <= hi; k++)
        if (fin[k]) {
          const g = Math.exp(-0.5 * ((k - i) / sigma) ** 2);
          num += g * v[k];
          den += g;
        }
      out[i] = num / den;
    }
  }
  return out;
}

/**
 * `smooth_activity`: gaussian filter along time like scipy's gaussian_filter1d (kernel reaches 4 sigma, the edges
 * repeat the nearest value). `sigmaS` is in seconds; 0 returns the signal unchanged.
 */
export function smoothNeural(v: ArrayLike<number>, fs: number, sigmaS: number): Float64Array {
  const sigma = sigmaS * fs;
  if (!(sigma > 0)) return Float64Array.from(v);
  const r = Math.trunc(4 * sigma + 0.5);
  const k = Array.from({ length: 2 * r + 1 }, (_, j) => Math.exp(-0.5 * ((j - r) / sigma) ** 2));
  const total = k.reduce((a, b) => a + b, 0);
  const n = v.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -r; j <= r; j++) s += k[j + r] * v[Math.min(n - 1, Math.max(0, i + j))];
    out[i] = s / total;
  }
  return out;
}

/**
 * `resample_signal` (linear): a signal on its own clock `tb`, onto the times `t`. A frame is NaN outside the
 * signal's range, where the nearest sample is NaN (a dropout), or, with `maxGapS`, between samples further apart
 * than that.
 */
export function resampleLinear(
  tb: ArrayLike<number>,
  v: ArrayLike<number>,
  t: ArrayLike<number>,
  maxGapS: number | null,
): Float64Array {
  const out = new Float64Array(t.length).fill(NaN);
  const tf: number[] = [];
  const vf: number[] = [];
  for (let i = 0; i < tb.length; i++)
    if (Number.isFinite(v[i])) {
      tf.push(tb[i]);
      vf.push(v[i]);
    }
  if (!tf.length) return out;
  const last = tf.length - 1;
  for (let i = 0; i < t.length; i++) {
    const x = t[i];
    if (x < tb[0] || x > tb[tb.length - 1]) continue;
    // last finite sample at or before x, and the one after it
    const k = Math.min(Math.max(upperBound(tf, x) - 1, 0), last);
    const k1 = Math.min(k + 1, last);
    let val: number;
    if (x <= tf[0]) val = vf[0];
    else if (x >= tf[last]) val = vf[last];
    else val = vf[k] + ((vf[k1] - vf[k]) * (x - tf[k])) / (tf[k1] - tf[k]);
    // the nearest raw sample decides whether a dropout carries over
    const j = Math.min(Math.max(lowerBound(tb, x), 1), Math.max(tb.length - 1, 1));
    const j0 = Math.min(Math.max(j - 1, 0), tb.length - 1);
    const j1 = Math.min(j, tb.length - 1);
    const near = Math.abs(x - tb[j0]) <= Math.abs(tb[j1] - x) ? j0 : j1;
    if (!Number.isFinite(v[near])) continue;
    if (maxGapS !== null) {
      const onSample = Math.abs(x - tf[k]) < 1e-9 || Math.abs(tf[k1] - x) < 1e-9;
      if (tf[k1] - tf[k] > maxGapS && !onSample) continue;
    }
    out[i] = val;
  }
  return out;
}

/**
 * `speed`: centered finite difference of position over a window of `windowS`. Near the edges the window moves
 * inward. NaN in x or y gives NaN for every frame whose window touches it. `fs` is the neural frame rate.
 */
export function speedOver(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  t: ArrayLike<number>,
  fs: number,
  windowS = 0.25,
): Float64Array {
  const n = x.length;
  const out = new Float64Array(n).fill(NaN);
  if (n < 2) return out;
  const w = Math.min(Math.max(1, pyRound(windowS * fs)), n - 1);
  for (let i = 0; i < n; i++) {
    const lo = Math.min(Math.max(i - (w >> 1), 0), n - 1 - w);
    const hi = lo + w;
    out[i] = Math.hypot(x[hi] - x[lo], y[hi] - y[lo]) / (t[hi] - t[lo]);
  }
  return out;
}

/**
 * `bouts_to_states` for one label: a frame is in a bout from the first frame at or after its start to the frame
 * before the first at or after its stop. Bouts are not widened or softened here.
 */
export function boutFrames(
  bouts: { start: number; stop: number }[],
  t: ArrayLike<number>,
): boolean[] {
  const out = new Array<boolean>(t.length).fill(false);
  for (const b of bouts) out.fill(true, lowerBound(t, b.start), lowerBound(t, b.stop));
  return out;
}

/** `clean_mask` with `dilate_s`: every run of true frames grows by round(dilateS * fs) frames on each side. */
export function dilateMask(m: boolean[], fs: number, dilateS: number): boolean[] {
  const n = pyRound(dilateS * fs);
  if (n <= 0) return m;
  const out = m.slice();
  let last = -Infinity;
  for (let i = 0; i < m.length; i++) if (m[i]) last = i;
  const near = new Array<number>(m.length).fill(Infinity);
  let prev = -Infinity;
  for (let i = 0; i < m.length; i++) {
    if (m[i]) prev = i;
    near[i] = i - prev;
  }
  prev = Infinity;
  for (let i = m.length - 1; i >= 0; i--) {
    if (m[i]) prev = i;
    near[i] = Math.min(near[i], prev - i);
    out[i] = near[i] <= n;
  }
  return last < 0 ? m : out;
}

export interface TimingReport {
  nFrames: number;
  fsMedian: number;
  /** Frames per second over the whole record: the rate the framework uses as the session's. */
  fsMean: number;
  nDropped: number;
  droppedFraction: number;
  /** Time of the frame before each gap, and the number of frames estimated lost in it. */
  gapStart: number[];
  gapFrames: number[];
  /** Standard deviation of the intervals that are not gaps (s). */
  jitterS: number;
}

/**
 * `timing_report`: a frame counts as dropped when the interval to the previous frame is over 1.5 times the median
 * interval. A gap of dt hides round(dt / median) - 1 frames, at least 1.
 */
export function timingReport(t: ArrayLike<number>): TimingReport {
  const n = t.length;
  if (n < 2) throw new Error('Need at least 2 time stamps for a timing report.');
  const dt = Array.from({ length: n - 1 }, (_, i) => t[i + 1] - t[i]);
  const med = nanMedian(dt.slice());
  if (!(med > 0)) throw new Error('The time stamps do not increase.');
  const gapStart: number[] = [];
  const gapFrames: number[] = [];
  const regular: number[] = [];
  dt.forEach((d, i) => {
    if (d > 1.5 * med) {
      gapStart.push(t[i]);
      gapFrames.push(Math.max(pyRound(d / med) - 1, 1));
    } else regular.push(d);
  });
  const nDropped = gapFrames.reduce((a, b) => a + b, 0);
  const m = regular.reduce((a, b) => a + b, 0) / (regular.length || 1);
  return {
    nFrames: n,
    fsMedian: 1 / med,
    fsMean: t[n - 1] > t[0] ? (n - 1) / (t[n - 1] - t[0]) : 1 / med,
    nDropped,
    droppedFraction: nDropped / (n + nDropped),
    gapStart,
    gapFrames,
    jitterS: Math.sqrt(regular.reduce((a, b) => a + (b - m) ** 2, 0) / (regular.length || 1)),
  };
}
