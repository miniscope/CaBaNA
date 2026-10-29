// Typed calls to the local Python bridge (gui/bridge). The bridge runs the framework; the GUI
// never computes a reported number itself.

import { parseNpy } from '@calab/io';
import type { NpyResult } from '@calab/core';

const PREFIX = '/api/cabana/v1';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface Capabilities {
  session_metadata: boolean;
  session_markers: boolean;
  peth_markers: boolean;
  frame_labels: boolean;
  decoding_fold_gap: boolean;
  decoding_fold_local_window: boolean;
  decoding_overall_test: boolean;
  overlap_policy: boolean;
  bayes_input_check: boolean;
  bin_eligibility: boolean;
  preview_flag: boolean;
  cli_rejects_recipes: boolean;
  peth_gui_extensions: boolean;
  _info?: { cabana_version: string | null; commit: string | null };
}
export type CapabilityName = Exclude<keyof Capabilities, '_info'>;

export type RunStatus = 'queued' | 'running' | 'ok' | 'partial' | 'cancelled' | 'failed';
export interface RunError {
  message: string;
  type?: string;
  traceback?: string;
}
export interface RunRecord {
  record_version: number;
  run_id: string;
  group_id: string | null;
  analysis: string;
  engine: 'framework' | 'browser-ts';
  status: RunStatus;
  scope: 'full' | 'preview';
  created_utc: string;
  finished_utc: string | null;
  session: {
    session_id: string;
    name?: string;
    inputs: { key: string; name?: string; sha256: string; bytes?: number }[];
    metadata_withheld?: boolean;
    withheld?: string[];
  };
  gui: {
    settings: unknown;
    settings_sha256: string | null;
    rejected_cells?: number[];
    [k: string]: unknown;
  };
  framework?: {
    cabana_version: string | null;
    commit: string | null;
    capabilities: Record<string, boolean>;
  };
  pipeline_file?: string;
  results_file: string | null;
  result_names?: string[];
  seeds?: { base: number | null };
  null_not_kept?: boolean;
  rejected_cell_ids?: string[];
  files?: string[];
  errors: RunError[];
  warnings: { message: string; category?: string }[];
}
export interface ProgressEvent {
  event: 'progress' | 'log' | 'warning' | 'error' | 'done';
  stage?: string;
  name?: string;
  fraction?: number;
  shuffles_done?: number | null;
  shuffles_total?: number | null;
  message?: string;
  status?: string;
}
export interface Issue {
  level: 'error' | 'warning' | 'info';
  analysis: string | null;
  code: string;
  message: string;
}
export interface ValidationReport {
  issues: Issue[];
  estimates?: Record<
    string,
    { n_frames_used: number | null; time_s: number | null; memory_bytes: number | null }
  >;
  total_time_s?: number | null;
  time_is_lower_bound?: boolean;
  peak_memory_bytes?: number | null;
  missing_capabilities?: string[];
  rejected_cell_ids?: string[];
}
export interface ManifestResult {
  name: string;
  metric: string;
  target: string;
  level: 'cell' | 'population';
  state_names: string[] | null;
  cell_ids: string[] | null;
  params: Record<string, unknown>;
  provenance: Record<string, unknown>;
  extras_by_name: Record<string, string>;
  plots: string[];
  shuffle?: Record<string, unknown>;
}
export interface Manifest {
  format: number;
  schema_version: string;
  status: string;
  results: ManifestResult[];
  errors: unknown[];
  warnings: unknown[];
}

export class BridgeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Where the bridge is, from `?bridge=` and `?bridge_secret=` (loopback only). */
export function bridgeConfig(search = typeof window === 'undefined' ? '' : window.location.search) {
  const params = new URLSearchParams(search);
  const raw = params.get('bridge');
  if (!raw) return null;
  try {
    const url = new URL(raw.includes('://') ? raw : `http://${raw}`);
    if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname)) return null;
    return { base: url.origin + PREFIX, secret: params.get('bridge_secret') ?? '' };
  } catch {
    return null;
  }
}

async function call(
  method: string,
  path: string,
  init: { body?: BodyInit; json?: unknown; headers?: HeadersInit } = {},
) {
  const cfg = bridgeConfig();
  if (!cfg) throw new BridgeError('Python engine not running', 0);
  const headers = new Headers(init.headers);
  headers.set('X-Bridge-Secret', cfg.secret);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(cfg.base + path, { method, headers, body });
  } catch {
    throw new BridgeError('Python engine not running', 0);
  }
  if (!res.ok) {
    let payload: Record<string, unknown> | undefined;
    try {
      payload = await res.clone().json();
    } catch {
      /* not JSON */
    }
    throw new BridgeError(
      String(payload?.error ?? `bridge error ${res.status}`),
      res.status,
      payload,
    );
  }
  return res;
}
const getJson = async <T>(path: string) => (await call('GET', path)).json() as Promise<T>;

/** SHA-256 of a file's bytes, hex. */
export async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const bridge = {
  health: () =>
    getJson<{
      ok: boolean;
      cabana_version: string | null;
      commit: string | null;
      bridge_version: string;
    }>('/health'),
  capabilities: () => getJson<Capabilities>('/capabilities'),

  /** Upload a file once; the bridge keeps it by hash. Returns its hash. */
  async upload(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const sha = await sha256(buffer);
    const head = await fetchStatus('HEAD', `/inputs/${sha}`);
    if (head !== 204)
      await call('PUT', `/inputs/${sha}?name=${encodeURIComponent(file.name)}`, { body: buffer });
    return sha;
  },
  async registerSession(config: unknown, files: Record<string, string>) {
    return (await call('POST', '/sessions', { json: { config, files } })).json() as Promise<{
      session_id: string;
      problems: string[];
      withheld: string[];
    }>;
  },
  sessionConfig: (id: string) => getJson<Record<string, unknown>>(`/sessions/${id}/config`),
  async sessionFile(id: string, sha: string): Promise<{ bytes: ArrayBuffer; name: string }> {
    const res = await call('GET', `/sessions/${id}/files/${sha}`);
    return { bytes: await res.arrayBuffer(), name: res.headers.get('X-Input-Name') ?? sha };
  },
  async validate(body: {
    session_id: string;
    pipeline: unknown;
    rejected_cells?: number[];
    requires?: string[];
  }) {
    return (await call('POST', '/validate', { json: body })).json() as Promise<ValidationReport>;
  },
  async startRun(body: Record<string, unknown>): Promise<string> {
    return ((await (await call('POST', '/runs', { json: body })).json()) as { run_id: string })
      .run_id;
  },
  listRuns: (sessionId?: string) =>
    getJson<RunRecord[]>(`/runs${sessionId ? `?session_id=${sessionId}` : ''}`),
  poll: (id: string, after: number) =>
    getJson<{ record: RunRecord; events: ProgressEvent[]; next: number }>(
      `/runs/${id}?events_after=${after}`,
    ),
  cancel: (id: string) => call('POST', `/runs/${id}/cancel`),
  remove: (id: string) => call('DELETE', `/runs/${id}`),
  manifest: (id: string) => getJson<Manifest>(`/runs/${id}/manifest`),
  async array(id: string, result: string, key: string): Promise<NpyResult> {
    const res = await call(
      'GET',
      `/runs/${id}/arrays/${encodeURIComponent(result)}/${encodeURIComponent(key)}.npy`,
    );
    return parseNpy(await res.arrayBuffer());
  },
  async tableCsv(id: string, result: string): Promise<string> {
    return (await call('GET', `/runs/${id}/table/${encodeURIComponent(result)}.csv`)).text();
  },
  summary: (id: string) => getJson<Record<string, unknown>[]>(`/runs/${id}/summary`),
  plotData: (id: string, result: string, kind: string) =>
    getJson<Record<string, unknown>>(`/runs/${id}/plotdata/${encodeURIComponent(result)}/${kind}`),
  async figure(id: string, result: string, kind: string, fmt: 'svg' | 'png'): Promise<Blob> {
    return (
      await call('GET', `/runs/${id}/figure/${encodeURIComponent(result)}/${kind}.${fmt}`)
    ).blob();
  },
  async bundle(id: string): Promise<Blob> {
    return (await call('GET', `/runs/${id}/bundle.zip`)).blob();
  },
  async saveBrowserRecord(record: Record<string, unknown>, files: Record<string, string>) {
    await call('POST', '/run-records', { json: { record, files } });
  },
  runFile: async (id: string, name: string) =>
    (await call('GET', `/runs/${id}/files/${encodeURIComponent(name)}`)).text(),
  getProject: () => getJson<Record<string, unknown>>('/project'),
  putProject: (data: unknown) => call('PUT', '/project', { json: data }),
};

async function fetchStatus(method: string, path: string): Promise<number> {
  try {
    return (await call(method, path)).status;
  } catch (e) {
    if (e instanceof BridgeError && e.status) return e.status;
    throw e;
  }
}

/** Non-finite floats in manifests are stored as `{"__float__": "nan" | "inf" | "-inf"}`. */
export function decodeFloats<T>(value: T): T {
  if (Array.isArray(value)) return value.map(decodeFloats) as T;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.__float__ === 'string' && Object.keys(obj).length === 1)
      return ({ nan: NaN, inf: Infinity, '-inf': -Infinity } as Record<string, number>)[
        obj.__float__
      ] as T;
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, decodeFloats(v)])) as T;
  }
  return value;
}
