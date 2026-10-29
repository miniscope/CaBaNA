import { describe, expect, it } from 'vitest';
import { readConfig } from '../lib/config-read.ts';
import { rolesFor, runsOf, withRole } from '../lib/frame-labels.ts';
import { preselectUnselected } from '../lib/labels.ts';
import { markerLabelCounts } from '../lib/markers.ts';
import { buildSessionConfig, sessionYaml } from '../lib/session-config.ts';
import { PARADIGMS } from '../lib/experiments.ts';
import { matchSlot } from '../lib/slots.ts';
import {
  addFiles,
  clearAll,
  frameMapping,
  labelRegistry,
  labelRoles,
  roleOf,
  setExperiment,
  setFrameRole,
  setRole,
  setSource,
  source,
} from '../lib/store.ts';

type Cfg = {
  behavior: { markers?: unknown; frame_labels: { scoring: unknown } };
  metadata?: { label_roles: unknown; stimuli: { label: string }[] };
};

const timestamps = (n: number, ms: number) =>
  'Frame Number,Time Stamp (ms),Buffer Index\n' +
  Array.from({ length: n }, (_, i) => `${i},${i * ms},0`).join('\n');
const FILES = () => [
  new File([timestamps(100, 50)], 'neural_timestamps.csv'),
  new File([timestamps(100, 50)], 'behavior_timestamps.csv'),
  new File(['label,time_s\ntone,1\ntone,3\nshock,4.5\ntone,99\n'], 'time_markers.csv'),
  new File(
    [
      [
        'frame,x,grooming,behavior',
        '0,1.5,1,grooming',
        '1,2.5,0,grooming',
        '2,3.5,0,rearing',
        '3,4,,',
      ].join('\n'),
    ],
    'frame_labels.csv',
  ),
];

describe('slots and paradigms', () => {
  it('match the new files by name', () => {
    expect(matchSlot('time_markers.csv')).toBe('time_markers');
    expect(matchSlot('session_ttl_log.csv')).toBe('time_markers');
    expect(matchSlot('frame_labels.csv')).toBe('frame_labels');
    expect(matchSlot('settle.csv')).toBeUndefined();
  });
  it('fear conditioning controls cs and us; others control nothing', () => {
    const c = (id: string) => PARADIGMS.find((p) => p.id === id)!.controlledLabels;
    expect(c('fear_conditioning')).toEqual(expect.arrayContaining(['cs', 'us']));
    expect(c('open_field')).toEqual([]);
  });
});

describe('helpers', () => {
  it('preselects by role and never leaves the list empty', () => {
    const roles = { cs: 'controlled', freezing: 'measured' } as const;
    const role = (n: string) => roles[n as keyof typeof roles] ?? 'measured';
    expect(preselectUnselected(['cs', 'freezing'], role, 'measured')).toEqual(['cs']);
    expect(preselectUnselected(['cs', 'freezing'], role, 'controlled')).toEqual(['freezing']);
    expect(preselectUnselected(['freezing'], role, 'controlled')).toEqual([]);
  });
  it('counts markers per label and notes the ones outside the recording', () => {
    const m = [
      { label: 'tone', timeS: 1 },
      { label: 'tone', timeS: 50 },
    ];
    expect(markerLabelCounts(m, [0, 10])).toEqual([
      { name: 'tone', count: 2, problems: ['1 outside recording'] },
    ]);
  });
  it('changes one column role and keeps a single frame column', () => {
    const t = { columns: ['n', 'frame', 'g'], rows: [['0', '0', '1']] };
    const roles = withRole(rolesFor(t), 'n', 'frame');
    expect(roles).toEqual({ n: 'frame', frame: 'ignore', g: 'binary' });
  });
  it('finds runs of frames', () => {
    expect(runsOf([0, 1, 2, 3, 4], (i) => i === 1 || i === 2 || i === 4)).toEqual([
      [1, 3],
      [4, 4],
    ]);
  });
});

describe('labels in the config', () => {
  it('writes markers, frame labels, roles and stimulus labels, and reads them back', async () => {
    clearAll();
    setExperiment('fear_conditioning');
    await addFiles(FILES());
    expect(
      labelRegistry()
        .map((e) => e.name)
        .sort(),
    ).toEqual(['grooming', 'grooming', 'rearing', 'shock', 'tone'].sort());
    setRole('shock', 'measured');
    setFrameRole('behavior', 'ignore');
    setFrameRole('behavior', 'categorical');
    setSource('stimuli', [
      { name: 'CS tone', kind: 'Tone or sound', label: 'tone', durationS: 20, note: '' },
    ]);

    const cfg = buildSessionConfig() as Cfg;
    expect(cfg.behavior.markers).toEqual({ cues: { file: 'time_markers.csv' } });
    expect(cfg.behavior.frame_labels.scoring).toEqual({
      file: 'frame_labels.csv',
      frame_column: 'frame',
      binary: ['grooming'],
      categorical: ['behavior'],
    });
    expect(cfg.metadata!.label_roles).toMatchObject({ tone: 'controlled', shock: 'measured' });
    expect(cfg.metadata!.stimuli[0].label).toBe('tone');
    // The copy that is run can leave the sections out.
    const run = buildSessionConfig(['metadata', 'markers', 'frame_labels']) as Cfg;
    expect(run.metadata).toBeUndefined();
    expect(run.behavior.markers).toBeUndefined();

    const text = sessionYaml();
    const before = {
      roles: { ...labelRoles },
      map: frameMapping(),
      stim: JSON.parse(JSON.stringify(source.stimuli)),
      rolesNow: ['tone', 'shock', 'grooming'].map(roleOf),
    };
    clearAll();
    setExperiment('custom');
    await addFiles([new File([text], 'config.yaml'), ...FILES()]);
    expect(readConfig(text).unknown).toEqual([]);
    expect(frameMapping()).toEqual(before.map);
    expect(JSON.parse(JSON.stringify(source.stimuli))).toEqual(before.stim);
    expect(['tone', 'shock', 'grooming'].map(roleOf)).toEqual(before.rolesNow);
    expect(sessionYaml()).toBe(text);
  });

  it('keeps a config without labels valid', () => {
    clearAll();
    const r = readConfig('neural: {file: a.npy}\nbehavior: {epochs: {b: {file: b.csv}}}\n');
    expect(r.problems).toEqual([]);
    expect(r.values.labelRoles).toBeUndefined();
    expect(r.values.frameMapping).toBeUndefined();
  });

  it('reads a marker group, a frame-label group and roles from a config', () => {
    const r = readConfig(
      [
        'neural: {file: a.npy}',
        'behavior:',
        '  markers: {cues: {file: m.csv}}',
        '  frame_labels: {s: {file: f.csv, frame_column: n, binary: [a], categorical: [b]}}',
        'metadata: {label_roles: {tone: controlled, x: other}}',
      ].join('\n'),
    );
    expect(r.files.time_markers).toBe('m.csv');
    expect(r.files.frame_labels).toBe('f.csv');
    expect(r.values.frameMapping).toEqual({ frameColumn: 'n', binary: ['a'], categorical: ['b'] });
    expect(r.values.labelRoles).toEqual({ tone: 'controlled' });
    expect(r.unknown).toEqual([]);
  });
});
