// Test-only: reads a framework results fixture (JSON dump) in the browser so the result views can
// be looked at without a run. Loaded only in the dev server, from `?decoding_fixture=<name>`.

import type { Manifest } from '../../lib/bridge-client.ts';
import type { Nd, ResultSource } from '../../lib/results-load.ts';

interface Dump {
  manifest: Manifest;
  arrays: Record<string, Record<string, Nd>>;
}
const files = import.meta.glob<Dump>('../../__tests__/fixtures/*.fixture.json', {
  import: 'default',
});

export async function browserFixture(name: string): Promise<ResultSource | undefined> {
  const load = files[`../../__tests__/fixtures/${name}.fixture.json`];
  if (!load) return undefined;
  const d = await load();
  const extrasOf = (r: string) =>
    (d.manifest.results.find((x) => x.name === r) as unknown as { extras: Record<string, string> })
      .extras;
  for (const r of d.manifest.results)
    r.extras_by_name = Object.fromEntries(
      Object.entries(extrasOf(r.name)).map(([stored, n]) => [n, stored]),
    );
  return {
    manifest: async () => d.manifest,
    array: async (result, key) => {
      const stored = Object.entries(extrasOf(result)).find(([, n]) => n === key)?.[0] ?? key;
      const hit = d.arrays[result]?.[stored];
      if (!hit) throw new Error(`no ${key}`);
      return hit;
    },
  };
}
