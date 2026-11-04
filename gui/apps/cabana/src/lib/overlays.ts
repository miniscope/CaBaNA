// Behavior overlays on the Data visualization plots: which bouts are drawn, how overlapping bouts
// share the band height, and which bout is under the mouse. No signals or drawing here.

export interface Bout {
  label: string;
  start: number;
  stop: number;
}

export interface AnnotationFile {
  id: string;
  name: string;
  epochs: Bout[];
}

export interface BehaviorInfo {
  name: string;
  bouts: number;
  seconds: number;
}

export interface FileGroup {
  id: string;
  name: string;
  /** Share of the session (0 to 1) covered by at least one bout of this file. */
  coverage: number;
  /** Starts unchecked: the file covers most of the session, so shading it tints the whole plot. */
  startsOff: boolean;
  behaviors: BehaviorInfo[];
}

/** A file covering more than this share of the session starts unchecked. */
export const MOST_OF_SESSION = 0.5;

export type Intensity = 'subtle' | 'strong';
export const ALPHA: Record<Intensity, number> = { subtle: 0.13, strong: 0.35 };

/** Seconds covered by at least one bout, counting overlaps once. */
export function coveredSeconds(bouts: Bout[]): number {
  let total = 0;
  let end = -Infinity;
  for (const b of [...bouts].sort((a, c) => a.start - c.start)) {
    const from = Math.max(b.start, end);
    if (b.stop > from) total += b.stop - from;
    end = Math.max(end, b.stop);
  }
  return total;
}

/** One group per annotation file, with the share of the session it covers and its behaviors. */
export function groupByFile(files: AnnotationFile[], sessionSeconds: number): FileGroup[] {
  return files.map((f) => {
    const coverage = sessionSeconds > 0 ? coveredSeconds(f.epochs) / sessionSeconds : 0;
    const names = [...new Set(f.epochs.map((e) => e.label))];
    return {
      id: f.id,
      name: f.name,
      coverage,
      startsOff: coverage > MOST_OF_SESSION,
      behaviors: names.map((name) => {
        const own = f.epochs.filter((e) => e.label === name);
        return { name, bouts: own.length, seconds: coveredSeconds(own) };
      }),
    };
  });
}

/** Saved choices by behavior name; names without a choice follow the file rule. */
export type Choices = Record<string, boolean>;

/** A behavior is on by default when any file that has it starts on. */
export function shownNames(groups: FileGroup[], choices: Choices): Set<string> {
  const on = new Set<string>();
  for (const g of groups)
    for (const b of g.behaviors) if (choices[b.name] ?? !g.startsOff) on.add(b.name);
  return on;
}

const allNames = (groups: FileGroup[]) => groups.flatMap((g) => g.behaviors.map((b) => b.name));

/** Choices that show or hide every behavior of the session; other saved names are kept. */
export function setAll(groups: FileGroup[], choices: Choices, on: boolean): Choices {
  return { ...choices, ...Object.fromEntries(allNames(groups).map((n) => [n, on])) };
}

/** Choices that show only `name`. */
export function isolate(groups: FileGroup[], choices: Choices, name: string): Choices {
  return { ...choices, ...Object.fromEntries(allNames(groups).map((n) => [n, n === name])) };
}

/** Bouts of the shown behaviors that touch the window. */
export function visibleBouts(
  files: AnnotationFile[],
  shown: Set<string>,
  [t0, t1]: [number, number],
): Bout[] {
  return files
    .flatMap((f) => f.epochs)
    .filter((e) => shown.has(e.label) && e.stop > e.start && e.stop >= t0 && e.start <= t1);
}

export interface Stripe {
  bout: Bout;
  /** Position from the top, 0-based, among the `lanes` stripes sharing this bout's time. */
  lane: number;
  lanes: number;
}

/**
 * Bouts that overlap in time, directly or through a chain of bouts, form a cluster. Each bout in a
 * cluster gets its own lane, and the band height is split evenly between the cluster's lanes. A
 * bout that overlaps nothing keeps the whole height. Colors are never blended.
 */
export function layoutStripes(bouts: Bout[]): Stripe[] {
  const sorted = [...bouts].sort((a, b) => a.start - b.start || a.stop - b.stop);
  const out: Stripe[] = [];
  let cluster: Stripe[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;
  const close = () => {
    for (const s of cluster) s.lanes = laneEnds.length;
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };
  for (const bout of sorted) {
    if (bout.start >= clusterEnd) close();
    let lane = laneEnds.findIndex((end) => end <= bout.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = bout.stop;
    clusterEnd = cluster.length ? Math.max(clusterEnd, bout.stop) : bout.stop;
    cluster.push({ bout, lane, lanes: 0 });
  }
  close();
  return out;
}

/** Top and height, as fractions of the band, of a stripe. */
export const stripeBox = (s: Stripe): [number, number] => [s.lane / s.lanes, 1 / s.lanes];

/** The stripe under (t, fy), where fy is the fraction down the band. `tol` widens bouts that are thinner than a pixel. */
export function hitStripe(stripes: Stripe[], t: number, fy: number, tol = 0): Stripe | undefined {
  return stripes.find((s) => {
    const [top, h] = stripeBox(s);
    return t >= s.bout.start - tol && t <= s.bout.stop + tol && fy >= top && fy < top + h;
  });
}

/** The bout of `label` at time `t` in a timeline row; the shortest one when several touch. */
export function hitRow(bouts: Bout[], label: string, t: number, tol = 0): Bout | undefined {
  return bouts
    .filter((b) => b.label === label && t >= b.start - tol && t <= b.stop + tol)
    .sort((a, b) => a.stop - a.start - (b.stop - b.start))[0];
}

export const sameBout = (a?: Bout, b?: Bout): boolean =>
  !!a && !!b && a.label === b.label && a.start === b.start && a.stop === b.stop;

/** Text of the hover tooltip. */
export function boutTip(b: Bout): { title: string; lines: string[] } {
  return {
    title: b.label,
    lines: [
      `Start ${b.start.toFixed(2)} s`,
      `Stop ${b.stop.toFixed(2)} s`,
      `Duration ${(b.stop - b.start).toFixed(2)} s`,
    ],
  };
}

/** "97% of session", or "<1% of session" for a file that covers almost nothing. */
export const coverageText = (c: number): string =>
  c > 0 && c < 0.01 ? '<1% of session' : `${Math.round(c * 100)}% of session`;
