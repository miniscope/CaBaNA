// The draft project of a new Data setup, with the engine's client replaced by an in-memory one.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataFile, ProjectSummary } from '../lib/projects-client.ts';

const disk = vi.hoisted(() => ({
  projects: new Map<
    string,
    { name: string; path: string; data: DataFile[]; labels: Record<string, string> }
  >(),
  removed: [] as string[],
  next: 1,
}));

vi.mock('../lib/projects-client.ts', async (orig) => {
  const real = await orig<typeof import('../lib/projects-client.ts')>();
  const summary = (id: string): ProjectSummary => {
    const p = disk.projects.get(id)!;
    return {
      id,
      name: p.name,
      path: p.path,
      created: '',
      modified: new Date().toISOString(),
      kinds: [],
      file_count: p.data.length,
      size_bytes: 0,
      missing_count: 0,
      readable: true,
      save_mode: 'auto',
      retention: 'every',
      copy_data: false,
    };
  };
  const text: Record<string, string> = {
    '/rec/neural_timestamps.csv': 'Frame Number,Time Stamp (ms)\n0,0\n1,33\n2,66\n',
  };
  return {
    ...real,
    projects: {
      create: async (name: string, parent?: string) => {
        const id = `p${disk.next++}`;
        disk.projects.set(id, { name, path: `${parent ?? '/root'}/${name}`, data: [], labels: {} });
        return summary(id);
      },
      open: async (t: { id: string }) => summary(t.id),
      close: async () => new Response(),
      rename: async (id: string, name: string) => {
        const p = disk.projects.get(id)!;
        p.name = name;
        p.path = p.path.replace(/[^/]+$/, name);
        return summary(id);
      },
      remove: async (id: string) => {
        disk.removed.push(id);
        disk.projects.delete(id);
        return { trashed_to: '/Trash' };
      },
      registerData: async (id: string, slot: string, path: string, label?: string) => {
        const p = disk.projects.get(id)!;
        const entry = {
          slot,
          path,
          size: text[path]?.length ?? 1,
          mtime: 0,
          sha256: path,
          name: path.split('/').pop()!,
          status: 'present',
          last_seen_path: null,
        } as DataFile;
        p.data = [...p.data.filter((d) => d.slot !== slot), entry];
        if (label) p.labels[slot] = label;
        return entry;
      },
      listData: async (id: string) => disk.projects.get(id)!.data,
      listDataAndLabels: async (id: string) => ({
        files: disk.projects.get(id)!.data,
        labels: disk.projects.get(id)!.labels,
      }),
      readFile: async (_id: string, name: string) => ({
        name,
        text: '{}\n',
        modified: '',
        valid: true,
        error: null,
        in_use: 'this',
      }),
      writeFile: async () => ({ saved_at: new Date().toISOString() }),
      fileBytes: async (sha: string) => new TextEncoder().encode(text[sha] ?? 'x').buffer,
      current: async () => null,
      list: async () => ({ root: '/root', projects: [] }),
    },
  };
});

const session = await import('../lib/project-session.ts');
const { openProject } = await import('../lib/open-project.ts');
const { clearAll, loaded, sessionName } = await import('../lib/store.ts');
const { sortScanned } = await import('../lib/data-files.ts');

describe('draft project', () => {
  beforeEach(async () => {
    clearAll();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('is made by the first file, named Untitled, and unsaved until named', async () => {
    await session.createDraft([{ path: '/rec/neural_timestamps.csv', slot: 'neural_timestamps' }]);
    expect(openProject()?.name).toMatch(/^Untitled project \d{4}-\d\d-\d\d \d{4}$/);
    expect(session.unsavedDraft()).toBe(true);
    expect(loaded.neural_timestamps?.shape).toBe('(3)');
    await session.nameDraft('m42 day 3');
    expect(openProject()?.name).toBe('m42 day 3');
    expect(sessionName()).toBe('m42 day 3');
    expect(session.unsavedDraft()).toBe(false);
  });

  it('is deleted on Delete draft, and kept (as saved) on Keep draft', async () => {
    await session.createDraft([]);
    const id = openProject()!.id;
    await session.discardDraft();
    expect(disk.removed).toContain(id);
    expect(openProject()).toBeUndefined();

    await session.createDraft([]);
    const next = vi.fn();
    const { question } = await import('../lib/confirm.ts');
    session.guardDraft(next);
    expect(question()?.title).toBe('Keep this draft or delete it?');
    question()!.alternative!.onSelect();
    expect(next).toHaveBeenCalled();
    expect(session.unsavedDraft()).toBe(false);
  });

  it('moves to another folder when Change… picked one', async () => {
    await session.createDraft([{ path: '/rec/neural_timestamps.csv', slot: 'neural_timestamps' }]);
    const old = openProject()!.id;
    await session.nameDraft('moved', '/elsewhere');
    expect(openProject()?.path).toBe('/elsewhere/moved');
    expect(disk.removed).toContain(old);
    expect(disk.projects.get(openProject()!.id)!.data.map((d) => d.slot)).toEqual([
      'neural_timestamps',
    ]);
  });

  it('checks the name', () => {
    expect(session.nameProblem('  ')).toBe('Enter a project name.');
    expect(session.nameProblem('a/b')).toBe('A project name cannot contain / \\ or :');
    expect(session.nameProblem('m42')).toBeUndefined();
  });
});

describe('sorting a scanned folder', () => {
  const f = (name: string) => ({ name, path: `/rec/${name}`, size: 1, modified: 0 });
  it('fills each data type once, and keeps the rest unassigned or ignored', () => {
    const r = sortScanned([
      f('neural_timestamps.csv'),
      f('neural_deconvolved.npy'),
      f('m42_deconvolved_v2.npy'),
      f('behavior_frame.png'),
      f('experiment.yaml'),
      f('processing.yaml'),
      f('cnmfe_A.npy'),
      f('behavCam.avi'),
      f('.DS_Store'),
    ]);
    expect(r.matched.map((m) => m.slot)).toEqual([
      'neural_timestamps',
      'neural_deconvolved',
      'behavior_frame',
      'config',
    ]);
    expect(r.unassigned.map((u) => u.name)).toEqual([
      'm42_deconvolved_v2.npy',
      'processing.yaml',
      'cnmfe_A.npy',
    ]);
    expect(r.ignored).toEqual(['behavCam.avi']);
  });
});
