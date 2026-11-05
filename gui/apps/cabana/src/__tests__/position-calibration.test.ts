// Pixel positions go to arena cm through one calibration, used by QC, previews, speed, the
// framework pipeline and its YAML export. Without a calibration nothing guesses a scale.

import { describe, expect, it } from 'vitest';
import {
  arena,
  calibrationIssue,
  positionTransform,
  positionsCm,
  setArena,
  setFrame,
  setSizeEntered,
} from '../lib/arena.ts';
import type { FrameSource } from '../lib/frame.ts';
import { positionCm, positionIssue } from '../lib/prepared.ts';
import { commonInput, preprocessYaml } from '../lib/session-config.ts';
import { commonSteps, UNCALIBRATED } from '../lib/spec/pipeline.ts';
import { addFiles, positionResult, setSource, source } from '../lib/store.ts';

// A 1920 x 1080 video shown at 1280 x 720 (1.5 video pixels per picture pixel). The arena outline
// on the picture is 800 x 400 px at (200, 100) for a 40 x 20 cm arena: 20 picture px per cm.
const K = 1.5;
const BOX = { x: 200, y: 100, w: 800, h: 400 };
const S = 20;
// Known points in arena cm (origin lower left, y up), one per second.
const CM: [number, number][] = [
  [0, 0],
  [40, 0],
  [40, 20],
  [12.5, 7.25],
];
const PX = CM.map(([x, y]) => [(BOX.x + x * S) * K, (BOX.y + BOX.h - y * S) * K]);

const close = (got: ArrayLike<number>, want: number[]) =>
  want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, 9));

async function loadPixels(): Promise<void> {
  setSource('positionUnit', 'px');
  setFrame({ kind: 'video', name: 'video', canvas: {} as HTMLCanvasElement, scale: K } as FrameSource);
  const rows = PX.map(([x, y], i) => `${i},${x},${y}`).join('\n');
  const stamps = CM.map((_, i) => `${i},${i * 1000}`).join('\n');
  await addFiles([
    new File([`frame,x,y\n${rows}\n`], 'position.csv'),
    new File([`frame number,time stamp\n${stamps}\n`], 'behavior_timestamps.csv'),
  ]);
}

describe('pixel calibration', () => {
  it('has no default scale', () => {
    expect('pxPerCm' in source).toBe(false);
  });

  it('blocks everything that needs cm until the arena is drawn', async () => {
    await loadPixels();
    expect(positionTransform()).toBeUndefined();
    expect(calibrationIssue()).toBe(UNCALIBRATED);
    expect(positionsCm().x).toEqual([]);
    expect(positionCm()).toBeUndefined();
    expect(positionResult()).toEqual({ error: UNCALIBRATED });
    expect(positionIssue()).toBe(UNCALIBRATED);
    const steps = commonSteps(commonInput());
    expect(steps.problems).toEqual([UNCALIBRATED]);
    expect(steps.transforms.some((t) => t.name === 'arena_transform')).toBe(false);
    expect(preprocessYaml()).toContain(`# Incomplete: ${UNCALIBRATED}`);
    // Analyses that never read position are not blocked.
    expect(commonSteps(commonInput(), { position: false }).problems).toEqual([]);
  });

  it('gives the same cm positions to the preview, QC speed and the framework step', async () => {
    setArena({ width: 40, height: 20, box: BOX });
    setSizeEntered(true);
    expect(arena.box).toEqual(BOX);

    // Previews and browser analyses.
    close(positionsCm().x, CM.map((p) => p[0]));
    close(positionsCm().y, CM.map((p) => p[1]));
    expect(positionCm()).toEqual(positionsCm());

    // QC speeds are cm/s from the same scale (one second between points).
    const qc = positionResult();
    if (!qc || !('speed' in qc)) throw new Error('QC failed');
    const d = (a: number, b: number) => Math.hypot(CM[b][0] - CM[a][0], CM[b][1] - CM[a][1]);
    close(qc.speed, [d(0, 1), d(1, 2), d(2, 3)]);

    // The framework step and the exported YAML carry the same transform, unrounded.
    const t = positionTransform()!;
    const steps = commonSteps(commonInput());
    expect(steps.problems).toEqual([]);
    expect(steps.transforms[0]).toEqual({
      name: 'arena_transform',
      signals: [''],
      scale: [t.sx, t.sy],
      translate: [t.tx, t.ty],
    });
    close(
      PX.map(([x]) => t.sx * x + t.tx),
      CM.map((p) => p[0]),
    );
    close(
      PX.map(([, y]) => t.sy * y + t.ty),
      CM.map((p) => p[1]),
    );
    expect(preprocessYaml()).toContain('arena_transform');
    expect(preprocessYaml()).not.toContain('# Incomplete');
  });
});
