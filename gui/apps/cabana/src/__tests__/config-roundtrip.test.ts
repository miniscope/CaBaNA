// A loaded config comes back unchanged from Download config except for what was edited in the
// GUI: zone shapes, order, paths and keys the GUI does not know all survive. The copy the
// framework runs drops only the keys its strict loader would reject.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { arena, nameTaken, freeName, setArena } from '../lib/arena.ts';
import { arenaProblem, configReport } from '../lib/config-import.ts';
import { commonSteps } from '../lib/spec/pipeline.ts';
import {
  buildSessionConfig,
  commonInput,
  exportedConfig,
  patchConfig,
  sessionYaml,
} from '../lib/session-config.ts';
import { addFiles, clearAll, loaded, setSource } from '../lib/store.ts';

const EXAMPLES = resolve(process.cwd(), '../../../example_data');
// The tracked examples; real recordings are kept out of the repository.
const SIMULATED = readdirSync(EXAMPLES).filter((d) => d.startsWith('simulated_'));

/** A folder's config and small text files (the large neural arrays are not needed here). */
function filesOf(dir: string, rename: Record<string, string> = {}): File[] {
  return readdirSync(resolve(EXAMPLES, dir))
    .filter((n) => /\.(csv|ya?ml)$/i.test(n))
    .map((n) => new File([readFileSync(resolve(EXAMPLES, dir, n))], rename[n] ?? n));
}
const original = (dir: string) =>
  parse(readFileSync(resolve(EXAMPLES, dir, 'config.yaml'), 'utf8'));
// Order matters too: JSON text compares keys in order.
const asText = (v: unknown) => JSON.stringify(v);

describe('Download config after loading a config', () => {
  it.each(SIMULATED)('%s comes back as it was loaded', async (dir) => {
    clearAll();
    await addFiles(filesOf(dir));
    expect(asText(parse(sessionYaml()))).toBe(asText(original(dir)));
  });

  it('changes only the edited field', async () => {
    clearAll();
    await addFiles(filesOf('simulated_3chamber'));
    setSource('clockOffsetS', 0.25);
    const want = original('simulated_3chamber');
    const got = exportedConfig() as typeof want;
    // x-range zones, the enclosures' contents and the dividers keep their original form.
    expect(asText(got.arena)).toBe(asText(want.arena));
    expect(asText(got.neural)).toBe(asText(want.neural));
    expect(got.behavior.clock).toEqual({ offset_s: 0.25 });
    expect({ ...got.behavior, clock: undefined }).toEqual({ ...want.behavior, clock: undefined });
  });

  it('does not rewrite zones when the arena outline is drawn and they are placed on the picture', async () => {
    clearAll();
    await addFiles(filesOf('simulated_3chamber'));
    setArena('box', { x: 37, y: 21, w: 613, h: 307 });
    expect(arena.zones.length).toBeGreaterThan(0);
    expect(asText(exportedConfig().arena)).toBe(asText(original('simulated_3chamber').arena));
  });

  it('keeps unknown keys in the download and leaves them out of the framework copy', async () => {
    clearAll();
    const text = readFileSync(resolve(EXAMPLES, 'simulated_clock_drift', 'config.yaml'), 'utf8');
    await addFiles([
      new File([`${text}\nlab_notes: {rig: B}\n`], 'config.yaml'),
      ...filesOf('simulated_clock_drift').filter((f) => f.name !== 'config.yaml'),
    ]);
    expect(configReport()?.unknown).toEqual(['lab_notes']);
    expect(exportedConfig().lab_notes).toEqual({ rig: 'B' });
    expect('lab_notes' in buildSessionConfig()).toBe(false);
  });
});

describe('an arena the GUI cannot read', () => {
  it('is reported, kept as written, and blocks the spatial grid until set by hand', async () => {
    clearAll();
    const cfg = 'neural: {file: n.npy, kind: deconvolved}\narena: {size: [600, 300], units: mm}\n';
    await addFiles([new File([cfg], 'config.yaml')]);
    expect(arenaProblem()).toMatch(/arena\.units "mm".*Set the arena size in Spatial setup/);
    expect(exportedConfig().arena).toEqual({ size: [600, 300], units: 'mm' });
    expect(buildSessionConfig().arena).toEqual({ size: [600, 300], units: 'mm' });
    expect(commonSteps(commonInput()).problems).toContain(arenaProblem());
    setArena('width', 60);
    expect(arenaProblem()).toBeUndefined();
    expect(arena.width).toBe(60);
  });
});

describe('recognizing files', () => {
  it('finds a renamed config by its content, and ignores YAML that is not a session config', async () => {
    clearAll();
    await addFiles([
      new File(['plot_style: dark\n'], 'config.yaml'),
      ...filesOf('simulated_clock_drift', { 'config.yaml': 'session settings.yml' }),
    ]);
    expect(loaded.config?.name).toBe('session settings.yml');
    expect(configReport()?.values.clockOffsetS).toBe(0.35);
    expect(loaded.position?.name).toBe('position.csv');
  });
});

describe('region names', () => {
  it('must be unique within zones, enclosures and dividers, not across them', async () => {
    clearAll();
    await addFiles(filesOf('simulated_3chamber'));
    expect(nameTaken('left', 'zone', 'rect')).toBe(true);
    expect(nameTaken('left', 'exclude', 'circle')).toBe(true);
    expect(nameTaken('left', 'exclude', 'polygon')).toBe(true);
    expect(nameTaken('door', 'zone', 'rect')).toBe(false);
    expect(freeName('zone', 'rect')).toBe('zone 1');
  });
});

describe('patchConfig', () => {
  it('keeps unchanged fields and folder paths, writes changes, drops removals', () => {
    const orig = { a: { file: 'data/x.csv', k: 1 }, z: { left: [0, 20], mid: [20, 40] }, extra: 1 };
    const base = {
      a: { file: 'x.csv', k: 1 },
      z: {
        left: [
          [0, 0],
          [20, 30],
        ],
        mid: [
          [20, 0],
          [40, 30],
        ],
      },
    };
    const cur = {
      a: { file: 'x.csv', k: 2 },
      z: {
        left: [
          [0, 0],
          [20, 30],
        ],
        new: [1, 2],
      },
    };
    expect(patchConfig(orig, base, cur)).toEqual({
      a: { file: 'data/x.csv', k: 2 },
      z: { left: [0, 20], new: [1, 2] },
      extra: 1,
    });
  });
});
