import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunRecord } from '../lib/bridge-client.ts';

const calls: string[] = [];
const record = (status: RunRecord['status']): RunRecord =>
  ({
    record_version: 1, run_id: 'r1', group_id: null, analysis: 'population', engine: 'framework', status, scope: 'full',
    created_utc: '', finished_utc: null, session: { session_id: 's', inputs: [] },
    gui: { settings: {}, settings_sha256: 'h' }, results_file: null, errors: [], warnings: [],
  }) as RunRecord;

vi.mock('../lib/bridge-client.ts', async (orig) => {
  const real = await orig<typeof import('../lib/bridge-client.ts')>();
  let polls = 0;
  return {
    ...real,
    bridge: {
      validate: vi.fn(async () => (calls.push('validate'), { issues: [] })),
      startRun: vi.fn(async (b: Record<string, unknown>) => (calls.push(`start:${b.scope}`), 'r1')),
      poll: vi.fn(async () => {
        polls += 1;
        calls.push('poll');
        return { record: record(polls < 3 ? 'running' : 'ok'), events: [{ event: 'progress', fraction: 0.5, name: 'x', stage: 'shuffle' }], next: polls };
      }),
      listRuns: vi.fn(async () => [record('ok')]),
      cancel: vi.fn(),
    },
  };
});
vi.mock('../lib/spec/session.ts', () => ({
  uploadSession: vi.fn(async () => ({ sessionId: 's', withheld: [], problems: [], inputs: {} })),
  configFileKeys: () => ({}),
}));
vi.mock('../lib/session-config.ts', () => ({ buildSessionConfig: () => ({}) }));

const { registerFrameworkAnalysis, runAnalysis, latest, active, lastError } = await import('../lib/runs.ts');

const spec = (problems: string[] = []) => ({ spec: { pipeline: { analyses: [] }, requires: [], problems, target: 't' }, settings: { a: 1 }, prepKeys: [] });

describe('runAnalysis', () => {
  beforeEach(() => { calls.length = 0; });
  it('validates, starts, polls to the end and keeps the latest record', async () => {
    registerFrameworkAnalysis('population', () => spec());
    const rec = await runAnalysis('population', 'preview');
    expect(rec?.status).toBe('ok');
    expect(calls.slice(0, 3)).toEqual(['validate', 'start:preview', 'poll']);
    expect(latest.population?.status).toBe('ok');
    expect(active()).toBeUndefined();
  });
  it('does not call the bridge when the spec has problems', async () => {
    registerFrameworkAnalysis('population', () => spec(['Choose at least one method.']));
    expect(await runAnalysis('population')).toBeUndefined();
    expect(calls).toEqual([]);
    expect(lastError()?.message).toMatch(/Choose at least one method/);
  });
});
