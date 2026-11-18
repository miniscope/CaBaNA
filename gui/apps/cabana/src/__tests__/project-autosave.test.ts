import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { beginAutosave, endAutosave, saveNow } from '../lib/autosave.ts';
import { setOpenProject } from '../lib/open-project.ts';
import { PROCESSING_HEADER, processingToData, yamlText } from '../lib/project-files.ts';
import { applyProcessing, captureProcessing } from '../lib/project-state.ts';
import { projects, type ProjectSummary } from '../lib/projects-client.ts';
import { setPrep } from '../lib/preprocess.ts';
import { saveStatus } from '../lib/save-status.ts';
import { clearAll, rejectCells } from '../lib/store.ts';

const project = (save_mode: 'auto' | 'manual' = 'auto'): ProjectSummary => ({
  id: 'p1',
  name: 'M24',
  path: '/p/M24',
  created: '',
  modified: '2026-11-18T10:00:00Z',
  kinds: [],
  file_count: 0,
  size_bytes: 0,
  missing_count: 0,
  readable: true,
  save_mode,
  retention: 'every',
  copy_data: false,
});

let write: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  clearAll();
  write = vi.spyOn(projects, 'writeFile').mockResolvedValue({ saved_at: '2026-11-18T10:42:00Z' });
});
afterEach(() => {
  endAutosave();
  setOpenProject(undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function open(mode: 'auto' | 'manual' = 'auto') {
  const p = project(mode);
  setOpenProject(p);
  beginAutosave(p, new Map());
}

describe('autosave', () => {
  it('writes the changed file about a second after the change stops, with a summary', async () => {
    open();
    setPrep('eventSigmaS', 0.2);
    await vi.advanceTimersByTimeAsync(900);
    expect(write).not.toHaveBeenCalled();
    setPrep('eventSigmaS', 0.25); // a further change restarts the wait
    await vi.advanceTimersByTimeAsync(900);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(write).toHaveBeenCalledTimes(1);
    const [id, name, body, summary] = write.mock.calls[0];
    expect([id, name, summary]).toEqual([
      'p1',
      'processing.yaml',
      'Event smoothing 0.25 s (was off)',
    ]);
    expect((body as { text: string }).text).toContain('event_smoothing_s: 0.25');
    expect(saveStatus().kind).toBe('saved');
  });

  it('writes nothing when nothing changed', async () => {
    open();
    await vi.advanceTimersByTimeAsync(3000);
    expect(write).not.toHaveBeenCalled();
  });

  it('saves a rejected cell when it applies', async () => {
    open();
    rejectCells([11], 'Low SNR');
    await vi.advanceTimersByTimeAsync(1100);
    expect(write.mock.calls[0][3]).toBe('Cell 12 rejected');
  });

  it('keeps changes for Save project in manual mode', async () => {
    open('manual');
    setPrep('fillGapS', 1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(write).not.toHaveBeenCalled();
    expect(saveStatus().kind).toBe('unsaved');
    await saveNow();
    expect(write).toHaveBeenCalledTimes(1);
    expect(saveStatus().kind).toBe('saved');
  });

  it('says the engine is off when a write cannot reach it, and tries again', async () => {
    open();
    const { BridgeError } = await import('../lib/bridge-client.ts');
    write.mockRejectedValueOnce(new BridgeError('Python engine not running', 0));
    setPrep('speedWindowS', 0.5);
    await vi.advanceTimersByTimeAsync(1100);
    expect(saveStatus().kind).toBe('engine-off');
    await vi.advanceTimersByTimeAsync(5100);
    expect(write).toHaveBeenCalledTimes(2);
    expect(saveStatus().kind).toBe('saved');
  });
});

describe('processing state', () => {
  it('is put back as it was saved', () => {
    setPrep('eventSigmaS', 0.2);
    rejectCells([3, 7], 'Low SNR');
    const saved = captureProcessing();
    const text = yamlText(processingToData(saved), PROCESSING_HEADER);
    clearAll();
    expect(captureProcessing().rejectedCells).toEqual([]);
    applyProcessing(parse(text));
    expect(captureProcessing()).toEqual(saved);
  });
});
