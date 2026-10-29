// Where the results views get their data: the bridge, with each fetched manifest and array kept
// in IndexedDB so a saved result stays inspectable after the bridge stops (plan: Results 6).
// Display state lives in the views; nothing here starts a run.

import { createSignal } from 'solid-js';
import { bridge, decodeFloats, type Manifest, type RunRecord } from './bridge-client.ts';
import { checkManifest, type Nd, type ResultSource } from './results-load.ts';

const DB = 'cabana-results-cache';
const STORE = 'items';

function db(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}
async function cacheGet<T>(key: string): Promise<T | undefined> {
  const d = await db();
  if (!d) return undefined;
  return new Promise((resolve) => {
    const req = d.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => resolve(undefined);
  });
}
async function cachePut(key: string, value: unknown): Promise<void> {
  const d = await db();
  if (!d) return;
  await new Promise<void>((resolve) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** Source of one saved run's results. `offline` turns true when a value came from the cache. */
export function runSource(runId: string): ResultSource & { offline: () => boolean } {
  const [offline, setOffline] = createSignal(false);
  const memory = new Map<string, Promise<unknown>>();
  const cached = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    let p = memory.get(key) as Promise<T> | undefined;
    if (!p) {
      p = (async () => {
        try {
          const value = await load();
          void cachePut(`${runId}/${key}`, value);
          return value;
        } catch (e) {
          const saved = await cacheGet<T>(`${runId}/${key}`);
          if (saved === undefined) throw e;
          setOffline(true);
          return saved;
        }
      })();
      memory.set(key, p);
      p.catch(() => memory.delete(key));
    }
    return p;
  };
  return {
    offline,
    manifest: () => cached('manifest', async () => checkManifest(await bridge.manifest(runId))),
    array: (result, key) =>
      cached(`array/${result}/${key}`, async (): Promise<Nd> => {
        const a = await bridge.array(runId, result, key);
        return {
          shape: a.shape,
          data: Array.from(a.data as ArrayLike<number>).map((v) => (Number.isFinite(v) ? v : null)),
        };
      }),
  };
}

/** Records are cached too, so the Results page lists saved runs with the bridge stopped. */
export async function cacheRecords(records: RunRecord[]): Promise<void> {
  await cachePut('records', records);
}
export const cachedRecords = async (): Promise<RunRecord[]> =>
  (await cacheGet<RunRecord[]>('records')) ?? [];
export { decodeFloats, type Manifest };

const TEST_ARRAYS = [
  'values',
  'sh_p_value',
  'sh_p_adj',
  'sh_null_lo',
  'sh_null_hi',
  'sh_significant',
  'sh_significant_adj',
];
const prefetched = new Set<string>();

/**
 * Keep a finished run's manifest and the arrays its views read (not the null draws) in the
 * browser cache, so Open works after the bridge stops. Never throws.
 */
export async function prefetchRun(runId: string): Promise<void> {
  if (prefetched.has(runId)) return;
  prefetched.add(runId);
  try {
    const src = runSource(runId);
    const manifest = await src.manifest();
    for (const r of manifest.results) {
      const keys = [...TEST_ARRAYS, ...Object.keys(r.extras_by_name ?? {})];
      await Promise.all(keys.map((k) => src.array(r.name, k).catch(() => undefined)));
    }
  } catch {
    prefetched.delete(runId); // try again the next time the run is listed
  }
}
