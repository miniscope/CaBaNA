// "Matches current settings" (plan D-34): a hash of everything that changes an analysis result,
// computed by the same code when a run starts and when it is compared. Display settings are never
// part of it.

import { sha256 } from './bridge-client.ts';

/** JSON with sorted keys and no whitespace, so equal settings give equal text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
  return JSON.stringify(value) ?? 'null';
}

export interface HashedSettings {
  settingsVersion: number;
  analysis: Record<string, unknown>;
  prep: Record<string, unknown>;
  inputs: Record<string, string>;
  rejected: number[];
  labelRoles: Record<string, string>;
  engine: string;
}
export const SETTINGS_VERSION = 1;

export async function settingsHash(settings: HashedSettings): Promise<string> {
  return sha256(new TextEncoder().encode(canonicalJson(settings)).buffer as ArrayBuffer);
}

/** Field-by-field differences between two settings objects, as `path: before -> after` lines. */
export function settingsDiff(before: unknown, after: unknown, path = ''): string[] {
  if (canonicalJson(before) === canonicalJson(after)) return [];
  const isObj = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  if (isObj(before) && isObj(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((k) => settingsDiff(before[k], after[k], path ? `${path}.${k}` : k));
  }
  const show = (v: unknown) => (v === undefined ? 'unset' : canonicalJson(v));
  return [`${path || 'value'}: ${show(before)} -> ${show(after)}`];
}
