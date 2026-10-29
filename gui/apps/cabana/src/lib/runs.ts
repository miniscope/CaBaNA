// Runs of framework analyses: one function starts any of them (page Run buttons, Run All and
// Rerun all call `runAnalysis`), progress comes from the bridge by polling, and the latest run per
// analysis is kept for the status and results views (plan P3, D-1, D-6, D-34, D-36).

import { batch, createSignal } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import {
  bridge,
  BridgeError,
  sha256,
  type ProgressEvent,
  type RunRecord,
  type ValidationReport,
} from './bridge-client.ts';
import { bridgeState, hasCapability } from './bridge-status.ts';
import { HashedSettings, SETTINGS_VERSION, settingsDiff, settingsHash } from './settings-hash.ts';
import { configFileKeys, uploadSession } from './spec/session.ts';
import type { BuiltSpec } from './spec/population.ts';
import { buildSessionConfig } from './session-config.ts';
import { labelRegistry, rejected, roleOf, slotFile } from './store.ts';
import { prep } from './preprocess.ts';
import type { CapabilityName } from './bridge-client.ts';

export type AnalysisId = 'place' | 'auroc' | 'peth' | 'decoding' | 'population';
export const POLL_MS = 500;

/** What a page hands to `runAnalysis`: the pipeline plus the settings it came from. */
export interface FrameworkRun {
  spec: BuiltSpec;
  /** Analysis settings (display settings excluded) and the Preprocess fields the analysis reads. */
  settings: Record<string, unknown>;
  prepKeys: string[];
}
type Builder = (scope: 'full' | 'preview') => FrameworkRun;
const builders: Partial<Record<AnalysisId, Builder>> = {};
export const registerFrameworkAnalysis = (id: AnalysisId, build: Builder) =>
  void (builders[id] = build);

export interface Active {
  id: AnalysisId;
  runId?: string;
  phase: 'preparing' | 'validating' | 'queued' | 'running' | 'cancelling';
  fraction: number;
  message: string;
  shuffles?: [number, number];
}
export const [active, setActive] = createSignal<Active | undefined>();
/** Latest run record per analysis. */
export const [latest, setLatest] = createStore<Partial<Record<AnalysisId, RunRecord>>>({});
/** Every record of the open session (the Results page). */
export const [history, setHistory] = createSignal<RunRecord[]>([]);
export const [lastError, setLastError] = createSignal<{
  id: AnalysisId;
  message: string;
  issues?: ValidationReport['issues'];
}>();

const fileHashes = new WeakMap<File, Promise<string>>();
const hashOf = (f: File) => {
  let p = fileHashes.get(f);
  if (!p) fileHashes.set(f, (p = f.arrayBuffer().then(sha256)));
  return p;
};

/** Hash of each input file named in the config, keyed by config path. */
async function inputHashes(): Promise<Record<string, string>> {
  const keys = configFileKeys(buildSessionConfig(), (id) => slotFile(id)?.name);
  const out: Record<string, string> = {};
  for (const [key, slot] of Object.entries(keys)) {
    const f = slotFile(slot);
    if (f) out[key] = await hashOf(f);
  }
  return out;
}

async function hashedSettings(run: FrameworkRun): Promise<HashedSettings> {
  const rolesUsed = Object.fromEntries(labelRegistry().map((e) => [e.name, roleOf(e.name)]));
  return {
    settingsVersion: SETTINGS_VERSION,
    analysis: run.settings,
    prep: Object.fromEntries(run.prepKeys.map((k) => [k, (prep as Record<string, unknown>)[k]])),
    inputs: await inputHashes(),
    rejected: [...rejected()].sort((a, b) => a - b),
    labelRoles: rolesUsed,
    engine: 'framework',
  };
}

/** The settings of one run of `id` compared with the current ones. */
export async function compareToRecord(
  id: AnalysisId,
  rec: RunRecord,
): Promise<{ matches: boolean; diff: string[] } | undefined> {
  const build = builders[id];
  if (!build) return undefined;
  const current = await hashedSettings(build(rec.scope));
  const matches = (await settingsHash(current)) === rec.gui.settings_sha256;
  return { matches, diff: matches ? [] : settingsDiff(rec.gui.settings, current) };
}

/** The settings of the latest run of `id` compared with the current ones. */
export async function compareToLatest(
  id: AnalysisId,
): Promise<{ matches: boolean; diff: string[] } | undefined> {
  const rec = latest[id];
  return rec ? compareToRecord(id, rec) : undefined;
}

const requiresText = (names: string[]) =>
  names.filter((n) => !hasCapability(n as CapabilityName)).map((n) => n);

/** Everything that blocks a run before the bridge is asked (empty = can run). */
export function blockers(id: AnalysisId): string[] {
  const build = builders[id];
  if (!build) return ['This analysis is not available.'];
  if (bridgeState().kind !== 'ready') return ['Python engine not running.'];
  const { spec } = build('full');
  const missing = requiresText(spec.requires);
  return [
    ...spec.problems,
    ...(missing.length ? [`Missing framework features: ${missing.join(', ')}.`] : []),
  ];
}

const TERMINAL = new Set(['ok', 'partial', 'cancelled', 'failed']);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let cancelRequested = false;

/** Start one analysis through the bridge and follow it to the end. Resolves with the final record. */
export async function runAnalysis(
  id: AnalysisId,
  scope: 'full' | 'preview' = 'full',
  groupId?: string,
): Promise<RunRecord | undefined> {
  const build = builders[id];
  if (!build || active()) return undefined;
  cancelRequested = false;
  setLastError(undefined);
  setActive({ id, phase: 'preparing', fraction: 0, message: 'Uploading inputs' });
  try {
    const run = build(scope);
    if (run.spec.problems.length) throw new BridgeError(run.spec.problems.join(' '), 0);
    const uploaded = await uploadSession();
    if (uploaded.problems.length) throw new BridgeError(uploaded.problems.join(' '), 0);
    setActive({ id, phase: 'validating', fraction: 0, message: 'Checking the pipeline' });
    const rejectedCells = [...rejected()].sort((a, b) => a - b);
    const report = await bridge.validate({
      session_id: uploaded.sessionId,
      pipeline: run.spec.pipeline,
      rejected_cells: rejectedCells,
      requires: run.spec.requires,
    });
    const errors = report.issues.filter((i) => i.level === 'error');
    if (errors.length) {
      // The framework reports one issue per failing test; the same text often repeats.
      const messages = [...new Set(errors.map((e) => e.message))];
      setLastError({ id, message: messages.join(' '), issues: report.issues });
      return undefined;
    }
    const settings = await hashedSettings(run);
    const runId = await bridge.startRun({
      session_id: uploaded.sessionId,
      analysis: id,
      pipeline: run.spec.pipeline,
      requires: run.spec.requires,
      rejected_cells: rejectedCells,
      gui_settings: settings,
      settings_sha256: await settingsHash(settings),
      scope,
      engine: 'framework',
      group_id: groupId,
    });
    setActive({ id, runId, phase: 'queued', fraction: 0, message: 'Queued' });
    return await follow(id, runId);
  } catch (e) {
    setLastError({ id, message: e instanceof Error ? e.message : String(e) });
    return undefined;
  } finally {
    setActive(undefined);
  }
}

async function follow(id: AnalysisId, runId: string): Promise<RunRecord> {
  let after = 0;
  for (;;) {
    const { record, events, next } = await bridge.poll(runId, after);
    after = next;
    const last = [...events].reverse().find((e: ProgressEvent) => e.event === 'progress');
    batch(() => {
      setActive(
        (a) =>
          a && {
            ...a,
            runId,
            phase: cancelRequested
              ? 'cancelling'
              : record.status === 'queued'
                ? 'queued'
                : 'running',
            fraction: last?.fraction ?? a.fraction,
            message: last ? `${last.name ?? ''} ${last.stage ?? ''}`.trim() : a.message,
            shuffles: last?.shuffles_total
              ? [last.shuffles_done ?? 0, last.shuffles_total]
              : a.shuffles,
          },
      );
    });
    if (TERMINAL.has(record.status)) {
      setLatest(produce((s) => void (s[id] = record)));
      await refreshHistory();
      return record;
    }
    await wait(POLL_MS);
  }
}

export async function cancelRun(): Promise<void> {
  const a = active();
  if (!a?.runId) return;
  cancelRequested = true;
  setActive({ ...a, phase: 'cancelling' });
  await bridge.cancel(a.runId);
}

/** Records of the open project, newest first; the latest of each analysis is picked out. */
export async function refreshHistory(): Promise<void> {
  const records = await bridge.listRuns();
  batch(() => {
    setHistory(records);
    for (const rec of [...records].reverse())
      setLatest(produce((s) => void (s[rec.analysis as AnalysisId] = rec)));
  });
}

export const isPreliminary = (r: RunRecord) => r.scope === 'preview';

/** Run several analyses in order; stops on cancel. Returns the ids that were started. */
export async function runAll(
  ids: AnalysisId[],
  scope: 'full' | 'preview' = 'full',
): Promise<AnalysisId[]> {
  const started: AnalysisId[] = [];
  const group = `all-${Date.now().toString(36)}`;
  for (const id of ids) {
    if (cancelRequested && started.length) break;
    started.push(id);
    await runAnalysis(id, scope, group);
  }
  return started;
}
