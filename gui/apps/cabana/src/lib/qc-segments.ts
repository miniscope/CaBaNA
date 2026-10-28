// Stretches of position tracking for the user to review on the Data QC page. Display only: the
// checks in qc.ts decide pass and fail.

import type { PositionQc } from './qc.ts';

export interface Segment {
  kind: 'jump' | 'lost';
  /** First and last frame of the segment, as indices into the position table. */
  first: number;
  last: number;
  /** Camera time in seconds. */
  start: number;
  stop: number;
  /** Jump: steps over the threshold. Lost: frames lost. */
  n: number;
  /** Jump: the fastest step, in cm/s. */
  peak?: number;
}

/**
 * Steps faster than `maxSpeed`, and lost stretches longer than `minLostS` (the limit the
 * "Longest lost stretch" check uses). Steps at most two frames apart form one segment, so a jump
 * away and back is listed once.
 */
export function positionSegments(p: PositionQc, maxSpeed: number, minLostS = 1): Segment[] {
  const out: Segment[] = [];
  let jump: Segment | undefined;
  p.speed.forEach((v, n) => {
    if (v <= maxSpeed) return;
    const i = p.idx[n];
    if (jump && i - jump.last <= 2) {
      Object.assign(jump, { last: i, stop: p.t[n], n: jump.n + 1, peak: Math.max(jump.peak!, v) });
    } else {
      jump = {
        kind: 'jump',
        first: i - 1,
        last: i,
        start: p.frameT[i - 1],
        stop: p.t[n],
        n: 1,
        peak: v,
      };
      out.push(jump);
    }
  });
  let run = -1;
  for (let i = 0; i <= p.x.length; i++) {
    const lost = i < p.x.length && !Number.isFinite(p.x[i]);
    if (lost && run < 0) run = i;
    if (!lost && run >= 0) {
      const n = i - run;
      if (n * p.dtFrame > minLostS)
        out.push({
          kind: 'lost',
          first: run,
          last: i - 1,
          start: p.frameT[run],
          stop: p.frameT[i - 1],
          n,
        });
      run = -1;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
