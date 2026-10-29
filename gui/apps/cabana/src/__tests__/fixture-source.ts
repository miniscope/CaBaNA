// Reads a framework results fixture (JSON dump of a results zip, made by
// gui/bridge/scripts/make_fixture_results.py) as the ResultSource the views use.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Manifest } from '../lib/bridge-client.ts';
import type { Nd, ResultSource } from '../lib/results-load.ts';

export interface Dump {
  manifest: Manifest;
  arrays: Record<string, Record<string, Nd>>;
}

export function openFixture(name: string): [Dump, ResultSource] {
  const path = resolve(process.cwd(), 'src/__tests__/fixtures', `${name}.fixture.json`);
  const d: Dump = JSON.parse(readFileSync(path, 'utf8'));
  const extrasOf = (r: string) =>
    (d.manifest.results.find((x) => x.name === r) as unknown as { extras: Record<string, string> }).extras;
  // the bridge adds extras_by_name to the manifest; the dump holds the raw one
  for (const r of d.manifest.results)
    r.extras_by_name = Object.fromEntries(Object.entries(extrasOf(r.name)).map(([stored, name]) => [name, stored]));
  return [
    d,
    {
      manifest: async () => d.manifest,
      array: async (result, key) => {
        const stored = Object.entries(extrasOf(result)).find(([, name]) => name === key)?.[0] ?? key;
        const hit = d.arrays[result]?.[stored];
        if (!hit) throw new Error(`no ${key}`);
        return hit;
      },
    },
  ];
}
