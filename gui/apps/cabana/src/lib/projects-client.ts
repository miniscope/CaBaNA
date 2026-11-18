// Typed calls for the engine's Projects endpoints (gui/bridge/README.md, "Projects").

import { bridgeCall, bridgeJson } from './bridge-client.ts';
import type { SlotId } from './slots.ts';

export type FileName = 'project.yaml' | 'experiment.yaml' | 'processing.yaml' | 'analysis.yaml';
export const CONFIG_FILES: FileName[] = [
  'project.yaml',
  'experiment.yaml',
  'processing.yaml',
  'analysis.yaml',
];
export type SaveMode = 'auto' | 'manual';
export type Retention = 'every' | 'latest3' | 'current';
export type DataKind = 'neural' | 'position' | 'behavior';

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  created: string;
  modified: string;
  kinds: DataKind[];
  file_count: number;
  size_bytes: number;
  missing_count: number;
  readable: boolean;
  save_mode: SaveMode;
  retention: Retention;
  copy_data: boolean;
}

export interface ConfigFile {
  name: FileName;
  text: string;
  modified: string;
  valid: boolean;
  error: { line: number; message: string } | null;
  in_use: 'this' | 'last-valid';
}

export type DataStatus = 'present' | 'changed' | 'moved' | 'missing';
export interface DataEntry {
  slot: SlotId;
  path: string;
  size: number;
  mtime: number;
  sha256: string;
  copied?: string;
}
export interface DataFile extends DataEntry {
  name: string;
  status: DataStatus;
  last_seen_path: string | null;
}

export interface ScannedFile {
  name: string;
  path: string;
  size: number;
  modified: number;
}
export type DialogKind = 'folder' | 'files' | 'save';
export type DialogResult = { paths: string[] } | { cancelled: true };

export interface FileChange {
  op: string;
  run_lines: [number, number];
  current_lines: [number, number];
  run: string[];
  current: string[];
}
export interface HistoryReport {
  changes: { time: string; file: string; summary: string }[];
  snapshots: { id: string; time: string; reason: string }[];
}
export interface StorageReport {
  categories: { id: string; label: string; bytes: number; deletable: boolean }[];
  runs: {
    run_id: string;
    analysis: string;
    scope: string;
    status: string;
    created: string;
    record_bytes: number;
    large_bytes: number;
    outputs_deleted: boolean;
  }[];
  total_bytes: number;
}
export type DeletableCategory = 'processed' | 'previews' | 'figures' | 'old_runs';
export interface ExportInclude {
  results: boolean;
  figures: boolean;
  data: boolean;
}

const post = (path: string, json?: unknown) =>
  bridgeCall('POST', path, json === undefined ? {} : { json });
const postJson = async <T>(path: string, json?: unknown) => (await post(path, json)).json() as T;
const enc = encodeURIComponent;

export const projects = {
  list: () => bridgeJson<{ root: string; projects: ProjectSummary[] }>('/projects'),
  current: async () =>
    (await bridgeJson<{ project: ProjectSummary | null }>('/projects/current')).project,
  create: (name: string, parent?: string) =>
    postJson<ProjectSummary>('/projects', { name, ...(parent && { parent }) }),
  /** The project by its id, or by the path of its folder or project.yaml. */
  open: (target: { id: string } | { path: string }) =>
    postJson<ProjectSummary>('/projects/open', target),
  close: () => post('/projects/close'),
  rename: (id: string, name: string) =>
    postJson<ProjectSummary>(`/projects/${id}/rename`, { name }),
  duplicate: (id: string, name?: string) =>
    postJson<ProjectSummary>(`/projects/${id}/duplicate`, name ? { name } : {}),
  remove: async (id: string) =>
    (await (await bridgeCall('DELETE', `/projects/${id}`)).json()) as { trashed_to: string },
  reveal: (id: string) => post(`/projects/${id}/reveal`),

  readFile: (id: string, name: FileName) => bridgeJson<ConfigFile>(`/projects/${id}/files/${name}`),
  /** Write a file from an object or from YAML text; `summary` is the line the history keeps. */
  writeFile: (
    id: string,
    name: FileName,
    body: { data: object } | { text: string },
    summary: string,
  ) =>
    bridgeCall('PUT', `/projects/${id}/files/${name}`, { json: { ...body, summary } }).then(
      (r) => r.json() as Promise<{ saved_at: string }>,
    ),
  compare: (id: string, name: FileName, run: string) =>
    bridgeJson<{ name: string; run: string; identical: boolean; changes: FileChange[] }>(
      `/projects/${id}/files/${name}/compare?run=${enc(run)}`,
    ),

  history: (id: string) => bridgeJson<HistoryReport>(`/projects/${id}/history`),
  restore: (id: string, snapshot: string) =>
    postJson<{ restored: string[]; saved_at: string }>(
      `/projects/${id}/history/${enc(snapshot)}/restore`,
    ),

  dialog: (kind: DialogKind, opts: { title?: string; default_name?: string } = {}) =>
    postJson<DialogResult>('/dialog', { kind, ...opts }),
  scan: (paths: string[]) => postJson<{ files: ScannedFile[] }>('/scan', { paths }),
  registerData: async (id: string, slot: SlotId, path: string) =>
    (await (await post(`/projects/${id}/data`, { slot, path })).json()) as DataEntry,
  removeData: (id: string, slot: SlotId) => bridgeCall('DELETE', `/projects/${id}/data/${slot}`),
  listData: async (id: string) =>
    (await bridgeJson<{ files: DataFile[] }>(`/projects/${id}/data`)).files,
  /** The bytes of a registered file, by hash. */
  fileBytes: async (sha: string) => (await bridgeCall('GET', `/files/${sha}`)).arrayBuffer(),

  storage: (id: string) => bridgeJson<StorageReport>(`/projects/${id}/storage`),
  deleteStorage: (id: string, category: DeletableCategory) =>
    postJson<{ freed_bytes: number }>(`/projects/${id}/storage/delete`, { category }),
  deleteOutputs: (runId: string) =>
    postJson<{ freed_bytes: number }>(`/runs/${runId}/delete-outputs`),
  exportProject: async (id: string, include: ExportInclude) =>
    (await post(`/projects/${id}/export`, { include })).blob(),
  importProject: (path: string) => postJson<ProjectSummary>('/projects/import', { path }),
};

/** The path of a dialog answer, or undefined when the user cancelled. */
export const chosenPaths = (r: DialogResult): string[] | undefined =>
  'paths' in r && r.paths.length ? r.paths : undefined;
