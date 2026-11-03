// Runs made by the browser engine are saved like framework runs: a run record with a persistent
// id, the settings and inputs it used, and its result tables as files. They are kept in this
// browser (so they survive a reload with the Python engine off) and copied to the project when
// the engine is running. A record already in the project is never sent again.

import { createSignal } from 'solid-js';
import { bridge, sha256, type RunRecord } from './bridge-client.ts';
import { cacheGet, cachePut } from './results-store.ts';
import { hashOf, type AnalysisId } from './runs.ts';
import { canonicalJson } from './settings-hash.ts';
import { SLOTS } from './slots.ts';
import { sessionName, slotFile } from './store.ts';

const KEY = 'browser-records';

interface Kept {
  record: RunRecord;
  files: Record<string, string>;
  /** Copied to the project through the bridge. */
  synced: boolean;
  /** Why the last copy failed, if it did. */
  syncError?: string;
}

const [kept, setKept] = createSignal<Kept[]>([]);
/** Browser-engine records kept in this browser, newest first. */
export const browserRecords = () => kept().map((k) => k.record);

const save = (list: Kept[]) => {
  setKept(list);
  return cachePut(KEY, list);
};

/** Read the kept records once at start. */
export async function loadBrowserRecords(): Promise<void> {
  setKept((await cacheGet<Kept[]>(KEY)) ?? []);
}

/** A stored file of a kept record, for reading with the Python engine off. */
export const keptFile = (runId: string, name: string) =>
  kept().find((k) => k.record.run_id === runId)?.files[name];

/** Every loaded input file with its SHA-256, as framework records list them. */
async function inputs(): Promise<RunRecord['session']['inputs']> {
  const out: RunRecord['session']['inputs'] = [];
  for (const { id } of SLOTS) {
    const f = slotFile(id);
    if (f) out.push({ key: id, name: f.name, sha256: await hashOf(f), bytes: f.size });
  }
  return out;
}

/**
 * Save a finished browser run. `settings` is what the analysis ran with (it must include the
 * executed shuffle count); `files` are its result tables.
 */
export async function saveBrowserRun(o: {
  analysis: AnalysisId;
  settings: Record<string, unknown>;
  seed?: number;
  files: Record<string, string>;
  started: Date;
}): Promise<RunRecord> {
  const text = canonicalJson(o.settings);
  const record: RunRecord = {
    record_version: 1,
    run_id: `browser-${crypto.randomUUID()}`,
    group_id: null,
    analysis: o.analysis,
    engine: 'browser-ts',
    status: 'ok',
    scope: 'full',
    created_utc: o.started.toISOString(),
    finished_utc: new Date().toISOString(),
    session: { session_id: 'browser', name: sessionName(), inputs: await inputs() },
    gui: {
      settings: o.settings,
      settings_sha256: await sha256(new TextEncoder().encode(text).buffer as ArrayBuffer),
    },
    seeds: { base: o.seed ?? null },
    results_file: null,
    files: Object.keys(o.files),
    errors: [],
    warnings: [],
  };
  await save([{ record, files: o.files, synced: false }, ...kept()]);
  void syncBrowserRecords();
  return record;
}

/** Drop a kept record (after it is deleted), so it does not come back on the next sync. */
export async function forgetBrowserRecord(runId: string): Promise<void> {
  if (kept().some((k) => k.record.run_id === runId))
    await save(kept().filter((k) => k.record.run_id !== runId));
}

/** Copy kept records the project does not have yet. Never throws. */
export async function syncBrowserRecords(): Promise<void> {
  let inProject: Set<string>;
  try {
    inProject = new Set((await bridge.listRuns()).map((r) => r.run_id));
  } catch {
    return; // engine not running: try again when it is
  }
  const list = [...kept()];
  for (const [i, k] of list.entries()) {
    if (k.synced) continue;
    if (inProject.has(k.record.run_id)) {
      list[i] = { ...k, synced: true, syncError: undefined };
      continue;
    }
    try {
      await bridge.saveBrowserRecord(k.record as unknown as Record<string, unknown>, k.files);
      list[i] = { ...k, synced: true, syncError: undefined };
    } catch (e) {
      list[i] = { ...k, syncError: e instanceof Error ? e.message : String(e) };
    }
  }
  await save(list);
}
