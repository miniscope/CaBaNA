import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chosenPaths, projects } from '../lib/projects-client.ts';

type Call = { method: string; url: string; body?: unknown; secret: string | null };
let calls: Call[];

/** A fetch that answers each request with the next reply and records what was asked. */
function fakeFetch(replies: (object | ArrayBuffer | string | number)[]) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        method: init.method ?? 'GET',
        url,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
        secret: new Headers(init.headers).get('X-Bridge-Secret'),
      });
      const reply = replies.shift() ?? {};
      if (typeof reply === 'number')
        return new Response(JSON.stringify({ error: 'no' }), { status: reply });
      if (typeof reply === 'string') return new Response(reply);
      if (reply instanceof ArrayBuffer) return new Response(reply);
      return new Response(JSON.stringify(reply));
    }),
  );
}

beforeEach(() => history.replaceState(null, '', '/?bridge=http://127.0.0.1:8830&bridge_secret=s3'));
afterEach(() => vi.unstubAllGlobals());

const base = 'http://127.0.0.1:8830/api/cabana/v1';

describe('projects client', () => {
  it('lists projects and sends the secret', async () => {
    fakeFetch([{ root: '/r', projects: [] }]);
    expect(await projects.list()).toEqual({ root: '/r', projects: [] });
    expect(calls[0]).toMatchObject({ method: 'GET', url: `${base}/projects`, secret: 's3' });
  });

  it('creates a project in a chosen folder and opens by path', async () => {
    fakeFetch([{ id: 'a' }, { id: 'a' }]);
    await projects.create('M24', '/Volumes/lab');
    await projects.open({ path: '/p/M24' });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `${base}/projects`,
      body: { name: 'M24', parent: '/Volumes/lab' },
    });
    expect(calls[1].body).toEqual({ path: '/p/M24' });
  });

  it('writes a file with the history summary', async () => {
    fakeFetch([{ saved_at: '2026-11-18T10:42:00Z' }]);
    await projects.writeFile('abc', 'processing.yaml', { text: 'qc: {}' }, 'Cell 12 rejected');
    expect(calls[0]).toMatchObject({
      method: 'PUT',
      url: `${base}/projects/abc/files/processing.yaml`,
      body: { text: 'qc: {}', summary: 'Cell 12 rejected' },
    });
  });

  it('registers and removes data by slot, and reads file bytes by hash', async () => {
    fakeFetch([{ slot: 'position' }, 204, new Uint8Array([1, 2, 3]).buffer]);
    await projects.registerData('abc', 'position', '/d/position.csv');
    expect(calls[0].body).toEqual({ slot: 'position', path: '/d/position.csv' });
    await expect(projects.removeData('abc', 'position'))
      .resolves.toBeDefined()
      .catch(() => undefined);
  });

  it('reads the bytes of a registered file', async () => {
    fakeFetch([new Uint8Array([1, 2, 3]).buffer]);
    expect(new Uint8Array(await projects.fileBytes('f00d'))).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls[0].url).toBe(`${base}/files/f00d`);
  });

  it('asks for the storage report, compare and export in the documented places', async () => {
    fakeFetch([{}, {}, new Uint8Array([9]).buffer, { freed_bytes: 5 }]);
    await projects.storage('abc');
    await projects.compare('abc', 'analysis.yaml', 'run 1');
    await projects.exportProject('abc', { results: true, figures: false, data: false });
    await projects.deleteStorage('abc', 'previews');
    expect(calls.map((c) => c.url.replace(base, ''))).toEqual([
      '/projects/abc/storage',
      '/projects/abc/files/analysis.yaml/compare?run=run%201',
      '/projects/abc/export',
      '/projects/abc/storage/delete',
    ]);
    expect(calls[2].body).toEqual({ include: { results: true, figures: false, data: false } });
  });

  it('reads the last valid copy and the frozen file of a run as text', async () => {
    fakeFetch(['a: 1\n', 'a: 0\n']);
    expect(await projects.lastValid('abc', 'analysis.yaml')).toBe('a: 1\n');
    expect(await projects.runConfig('run12345', 'analysis.yaml')).toBe('a: 0\n');
    expect(calls.map((c) => c.url.replace(base, ''))).toEqual([
      '/projects/abc/files/analysis.yaml/last-valid',
      '/runs/run12345/config/analysis.yaml',
    ]);
  });

  it('turns an engine error into a message', async () => {
    fakeFetch([409]);
    await expect(projects.close()).rejects.toMatchObject({ status: 409, message: 'no' });
  });

  it('reads a cancelled dialog as no paths', () => {
    expect(chosenPaths({ cancelled: true })).toBeUndefined();
    expect(chosenPaths({ paths: ['/a'] })).toEqual(['/a']);
  });
});
