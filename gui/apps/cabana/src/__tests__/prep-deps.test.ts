import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANALYSIS_LABEL, DEPS, STEPS, usedBy } from '../lib/prep-deps.ts';

const SRC = join(__dirname, '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const walk = (dir: string): string[] =>
  readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );

// Each file that imports prepared data (prepared.ts, decode-data.ts), and the analysis it belongs to.
// A new importing file must be added here, which forces a decision about its DEPS entry.
const READERS: Record<string, keyof typeof DEPS | 'preprocess-page'> = {
  'panels/PlaceCellsPanel.tsx': 'place',
  'panels/PlaceMapsSettings.tsx': 'place',
  'panels/PlaceReviewStage.tsx': 'place',
  'lib/place-run.ts': 'place',
  'lib/place-coverage.ts': 'place',
  'lib/auroc-run.ts': 'auroc',
  'lib/peth-run.ts': 'peth',
  'lib/decode-data.ts': 'decoding',
  'lib/decoding-browser.ts': 'decoding',
  'panels/decoding/state.ts': 'decoding',
  'panels/population/data.ts': 'population',
  'panels/BehaviorQc.tsx': 'preprocess-page',
  'panels/PreprocessPanel.tsx': 'preprocess-page',
  'panels/PrepPlots.tsx': 'preprocess-page',
  'lib/prep-view.ts': 'preprocess-page',
};

describe('DEPS lists every analysis that reads prepared data', () => {
  const importsPrepared = (f: string) => /from '[^']*\/(prepared|decode-data)\.ts'/.test(read(f));
  const files = walk('lib').concat(walk('panels')).filter(importsPrepared);

  it('knows every file that imports prepared data', () => {
    expect(files.filter((f) => !(f in READERS))).toEqual([]);
  });

  it('has an entry for the analysis of each reader', () => {
    for (const a of Object.values(READERS))
      if (a !== 'preprocess-page') expect(DEPS).toHaveProperty(a);
  });

  it('has an entry for every registered analysis', () => {
    const ids = [
      ...read('lib/analysis-registry.ts').matchAll(/registerFrameworkAnalysis\('(\w+)'/g),
    ].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(DEPS).toHaveProperty(id);
  });

  it('labels every entry and refers only to known steps', () => {
    for (const id of Object.keys(DEPS) as (keyof typeof DEPS)[]) {
      expect(ANALYSIS_LABEL[id]).toBeTruthy();
      for (const s of Object.keys(DEPS[id])) expect(STEPS).toHaveProperty(s);
    }
  });

  it('shows Decoding and Population as users of the position steps, not Decoding of event smoothing', () => {
    expect(usedBy('fillGaps').map((u) => u.id)).toEqual(
      expect.arrayContaining(['decoding', 'population']),
    );
    expect(usedBy('eventSmooth').map((u) => u.id)).not.toContain('decoding');
  });
});
