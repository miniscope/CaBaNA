// What the New Project page works out from the files held in its list: the default project name,
// the size line and the note about missing required files.

import { SLOTS, type SlotId } from './slots.ts';

type Picked = File & { webkitRelativePath?: string };

/** The path a file was picked with: inside its folder when a folder was chosen, else its name. */
export const pathOf = (f: File): string => (f as Picked).webkitRelativePath || f.name;

/** Held files with `added` on top; a file picked again (same path) replaces the earlier one. */
export function mergeHeld(held: File[], added: File[]): File[] {
  const again = new Set(added.map(pathOf));
  return [...held.filter((f) => !again.has(pathOf(f))), ...added];
}

/**
 * The default project name: the nearest folder all files share (a chosen folder's name), else
 * `Project YYYY-MM-DD` for loose files.
 */
export function defaultProjectName(files: File[], now = new Date()): string {
  const dirs = files.map((f) => pathOf(f).split('/').slice(0, -1));
  const shared = dirs.length ? dirs.reduce((a, d) => a.slice(0, commonLength(a, d))) : [];
  if (shared.length) return shared[shared.length - 1];
  const p = (n: number) => String(n).padStart(2, '0');
  return `Project ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const commonLength = (a: string[], b: string[]) => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};

/** "122 KB", "6.5 MB", "627 B". */
export function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`;
  if (n < 1e6) return `${Math.round(n / 1e3)} KB`;
  return `${(n / 1e6).toFixed(1)} MB`;
}

/** The note under the list: which required files are missing, or that both are here. */
export function requiredNote(matched: ReadonlySet<SlotId>): { ok: boolean; missing: string[] } {
  const missing = SLOTS.filter((s) => s.level === 'required' && !matched.has(s.id)).map(
    (s) => s.label,
  );
  return { ok: !missing.length, missing };
}

/**
 * The default name for a project made from files at known paths: the nearest folder they share,
 * else `Project YYYY-MM-DD` when that folder is the home folder or a disk root.
 */
export function defaultNameFromPaths(paths: string[], now = new Date()): string {
  const dirs = paths.map((p) => p.split('/').slice(0, -1));
  const shared = dirs.length ? dirs.reduce((a, d) => a.slice(0, commonLength(a, d))) : [];
  const home = paths[0]?.match(/^\/Users\/[^/]+/)?.[0].split('/') ?? [];
  const isRoot = shared.length <= 1 || (shared[1] === 'Volumes' && shared.length <= 3);
  const isHome = home.length > 0 && shared.length <= home.length;
  if (!isRoot && !isHome) return shared[shared.length - 1];
  const p = (n: number) => String(n).padStart(2, '0');
  return `Project ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
