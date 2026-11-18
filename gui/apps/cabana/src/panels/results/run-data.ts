// What a saved run holds, read once and kept while the page is open: the overview headline, the
// export menus and the explorer all ask for the same thing.

import { bridgeReady } from '../../lib/bridge-status.ts';
import type { RunRecord } from '../../lib/bridge-client.ts';
import { loadExplorerData, type ExplorerData } from '../../lib/explorer-data.ts';

const cache = new Map<string, Promise<ExplorerData>>();

/** The tables and statistics of a run. Read again when the engine comes or goes, which changes what is readable. */
export function savedData(r: RunRecord): Promise<ExplorerData> {
  const key = `${r.run_id}:${bridgeReady()}`;
  let found = cache.get(key);
  if (!found) {
    found = loadExplorerData(r);
    cache.set(key, found);
    // A failed read is not kept, so a later try can succeed.
    found.catch(() => cache.delete(key));
  }
  return found;
}
