// Reading a session config.yaml in the framework's layout (`SessionDirConfig` in
// cabana/_loaders/_session_dir.py) into the values the GUI uses. No stores here, so
// it can be tested; config-import.ts applies the result.

import { parse } from 'yaml';
import type { SlotId } from './slots.ts';
import type { LabelRole } from './labels.ts';

type Pt = [number, number];
/** A zone in cm from the arena's lower left corner, y up. circle: centre, then a point on the edge. */
export interface CmZone {
  name: string;
  kind: 'zone' | 'exclude';
  shape: 'rect' | 'circle' | 'polygon';
  pts: Pt[];
}

/** GUI fields kept in the config's `metadata:` block, which the framework stores but does not use. */
export const META_FIELDS = [
  ['species', 'species'],
  ['brain_region', 'brainRegion'],
  ['group', 'group'],
  ['date', 'sessionDate'],
  ['miniscope', 'device'],
  ['tracked_body_part', 'bodyPart'],
  ['likelihood_threshold', 'likelihoodMin'],
] as const;
/** Flip y in the arena's height, the same step for positions and zones. */
export const flipY = (y: number, height: number) => height - y;

export type MetaField = (typeof META_FIELDS)[number][1];

export interface Stimulus {
  name: string;
  kind: string;
  /** The loaded label that says when it happened. */
  label?: string;
  durationS?: number;
  note: string;
}

export interface ConfigValues {
  name?: string;
  neuralFps?: number;
  clockOffsetS?: number;
  clockScale?: number;
  positionUnit?: 'cm' | 'px';
  maxGapS?: number;
  headOffsetDeg?: number;
  mergeGapS?: number;
  minBoutS?: number;
  arena?: { width: number; height: number; shape: 'rectangle' | 'circle' };
  zones?: CmZone[];
  bodyLengthCm?: number;
  /** The position file has y growing downward (metadata.y_increases: down). */
  yDown?: boolean;
  subjectId?: string;
  meta: Partial<Record<MetaField, string | number>>;
  stimuli?: Stimulus[];
  /** metadata.label_roles, keyed by exact label. */
  labelRoles?: Record<string, LabelRole>;
  /** The config's name for the time-marker file and the frame-label file, so an export keeps them. */
  markersName?: string;
  frameLabelsName?: string;
  /** behavior.frame_labels: which columns are the frame number, binary labels and categories. */
  frameMapping?: { frameColumn: string; binary: string[]; categorical: string[] };
  /** The config's name for each epoch file, so an export keeps it. */
  epochNames: Partial<Record<SlotId, string>>;
}

export interface ConfigRead {
  values: ConfigValues;
  /** File name (without folder) the config gives for each slot. */
  files: Partial<Record<SlotId, string>>;
  /** Keys the GUI reads, as dotted paths. */
  read: string[];
  /** Framework keys the GUI does not use; written back unchanged on export. */
  kept: { path: string[]; value: unknown }[];
  /** Keys that are not in the framework's layout. The framework would reject the file. */
  unknown: string[];
  /** Missing or incompatible settings, in words. */
  problems: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const base = (p: unknown) => (typeof p === 'string' ? p.split(/[\\/]/).pop() : undefined);
const isPt = (p: unknown): p is Pt =>
  Array.isArray(p) && p.length === 2 && p.every((v) => num(v) !== undefined);

// Framework keys per section, split into the ones the GUI reads and the ones it only keeps.
const SECTIONS: Record<string, { read: string[]; keep: string[] }> = {
  '': { read: ['name', 'neural', 'behavior', 'arena', 'subjects', 'metadata'], keep: [] },
  neural: {
    read: ['file', 'kind', 'timestamps', 'fs', 'alternatives'],
    keep: ['key', 'orientation', 'cell_ids'],
  },
  behavior: {
    read: [
      'timestamps',
      'clock',
      'position',
      'head_orientation',
      'epochs',
      'markers',
      'frame_labels',
    ],
    keep: ['signals'],
  },
  'behavior.clock': { read: ['offset_s', 'scale'], keep: [] },
  'behavior.position': {
    read: ['file', 'units', 'max_gap_s'],
    keep: ['frame_column', 'columns', 'missing_value'],
  },
  'behavior.head_orientation': {
    read: ['file', 'offset_deg'],
    keep: ['format', 'output', 'euler'],
  },
  arena: { read: ['size', 'units', 'zones', 'enclosures', 'dividers'], keep: [] },
  subjects: { read: ['focal'], keep: ['stimulus'] },
};

const NEURAL_SLOT: Record<string, SlotId> = {
  deconvolved: 'neural_deconvolved',
  denoised: 'neural_denoised',
  raw: 'neural_raw',
};

/** Read a config.yaml. Nothing throws: problems are listed in the result. */
export function readConfig(text: string): ConfigRead {
  const r: ConfigRead = {
    values: { meta: {}, epochNames: {} },
    files: {},
    read: [],
    kept: [],
    unknown: [],
    problems: [],
  };
  let cfg: unknown;
  try {
    cfg = parse(text);
  } catch (e) {
    r.problems.push(`The file is not valid YAML: ${e instanceof Error ? e.message : String(e)}`);
    return r;
  }
  if (!isObj(cfg)) {
    r.problems.push('The file has no settings in it.');
    return r;
  }
  if ('arena_cm' in cfg)
    r.problems.push(
      'This looks like the older flat layout (arena_cm, zones at the top level). Only the framework layout is read; download a config from Experimental Setup to see it.',
    );
  classify(cfg, '', r);
  readValues(cfg, r);
  return r;
}

/** Sort every key into read, kept or unknown, by the framework's layout. */
function classify(o: Obj, at: string, r: ConfigRead): void {
  const s = SECTIONS[at];
  for (const [k, v] of Object.entries(o)) {
    const path = at ? `${at}.${k}` : k;
    if (s.keep.includes(k)) r.kept.push({ path: path.split('.'), value: v });
    else if (!s.read.includes(k)) r.unknown.push(path);
    else if (SECTIONS[path] && isObj(v)) classify(v, path, r);
    else if (path !== 'metadata') r.read.push(path);
  }
}

function readValues(cfg: Obj, r: ConfigRead): void {
  const v = r.values;
  v.name = str(cfg.name);

  const neural = isObj(cfg.neural) ? cfg.neural : undefined;
  if (!neural?.file) r.problems.push('neural.file is missing; the framework requires it.');
  if (neural) {
    const kind = str(neural.kind) ?? 'deconvolved';
    if (NEURAL_SLOT[kind]) r.files[NEURAL_SLOT[kind]] = base(neural.file);
    else
      r.problems.push(
        `neural.kind "${kind}" is not one the GUI shows (deconvolved, denoised, raw).`,
      );
    if (isObj(neural.alternatives))
      for (const [k, f] of Object.entries(neural.alternatives)) {
        if (NEURAL_SLOT[k]) r.files[NEURAL_SLOT[k]] = base(f);
        else r.problems.push(`neural.alternatives.${k} is not a layer the GUI shows.`);
      }
    r.files.neural_timestamps = base(neural.timestamps);
    v.neuralFps = num(neural.fs);
  }

  const beh = isObj(cfg.behavior) ? cfg.behavior : {};
  r.files.behavior_timestamps = base(beh.timestamps);
  if (isObj(beh.clock)) {
    v.clockOffsetS = num(beh.clock.offset_s);
    v.clockScale = num(beh.clock.scale);
  }
  if (isObj(beh.position)) {
    r.files.position = base(beh.position.file);
    v.maxGapS = num(beh.position.max_gap_s);
    const u = beh.position.units ?? 'cm';
    if (u === 'cm' || u === 'px') v.positionUnit = u;
    else r.problems.push(`behavior.position.units "${String(u)}": the GUI reads cm or px.`);
  }
  if (isObj(beh.head_orientation)) {
    r.files.head_orientation = base(beh.head_orientation.file);
    v.headOffsetDeg = num(beh.head_orientation.offset_deg);
  }
  if (isObj(beh.epochs)) readEpochs(beh.epochs, r);
  if (isObj(beh.markers)) readMarkerGroups(beh.markers, r);
  if (isObj(beh.frame_labels)) readFrameLabelGroups(beh.frame_labels, r);

  if (isObj(cfg.arena)) readArena(cfg.arena, r, cfg.metadata, v.positionUnit);

  if (isObj(cfg.subjects)) v.subjectId = str(cfg.subjects.focal);

  if (isObj(cfg.metadata)) readMetadata(cfg.metadata, r);

  for (const k of Object.keys(r.files) as SlotId[]) if (!r.files[k]) delete r.files[k];
}

/** Exclusive epochs go to the zone file, the others to the behavior file; the GUI holds one of each. */
function readEpochs(epochs: Obj, r: ConfigRead): void {
  for (const [name, e] of Object.entries(epochs)) {
    if (!isObj(e)) continue;
    const slot: SlotId = e.exclusive ? 'zone_annotations' : 'behavior_annotations';
    if (r.values.epochNames[slot]) {
      r.kept.push({ path: ['behavior', 'epochs', name], value: e });
      r.problems.push(
        `Epoch file "${name}" is kept but not loaded: the GUI holds one ${e.exclusive ? 'zone' : 'behavior'} annotation file.`,
      );
      continue;
    }
    r.values.epochNames[slot] = name;
    r.files[slot] = base(e.file);
    r.values.mergeGapS ??= num(e.merge_gap_s);
    r.values.minBoutS ??= num(e.min_duration_s);
  }
}

/** The GUI holds one time-marker file; further groups are kept in the export but not loaded. */
function readMarkerGroups(groups: Obj, r: ConfigRead): void {
  for (const [name, g] of Object.entries(groups)) {
    if (!isObj(g)) continue;
    if (r.values.markersName) {
      r.kept.push({ path: ['behavior', 'markers', name], value: g });
      r.problems.push(
        `Marker file "${name}" is kept but not loaded: the GUI holds one time-marker file.`,
      );
      continue;
    }
    r.values.markersName = name;
    r.files.time_markers = base(g.file);
  }
}

const strings = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** The GUI holds one frame-label file; further groups are kept in the export but not loaded. */
function readFrameLabelGroups(groups: Obj, r: ConfigRead): void {
  for (const [name, g] of Object.entries(groups)) {
    if (!isObj(g)) continue;
    if (r.values.frameLabelsName) {
      r.kept.push({ path: ['behavior', 'frame_labels', name], value: g });
      r.problems.push(
        `Frame-label file "${name}" is kept but not loaded: the GUI holds one frame-label file.`,
      );
      continue;
    }
    r.values.frameLabelsName = name;
    r.files.frame_labels = base(g.file);
    r.values.frameMapping = {
      frameColumn: str(g.frame_column) ?? 'frame',
      binary: strings(g.binary),
      categorical: strings(g.categorical),
    };
  }
}

function readArena(a: Obj, r: ConfigRead, meta: unknown, positionUnit?: 'cm' | 'px'): void {
  const units = a.units ?? 'cm';
  if (units !== 'cm') {
    r.problems.push(
      `arena.units "${String(units)}": the GUI works in cm, so the arena was not read.`,
    );
    return;
  }
  const size = Array.isArray(a.size) ? a.size.map(num) : [];
  const [w, h] = size;
  if (w === undefined || h === undefined) {
    r.problems.push('arena.size is missing; zones need it.');
    return;
  }
  const circle = isObj(meta) && meta.arena_shape === 'circle';
  r.values.arena = { width: w, height: h, shape: circle ? 'circle' : 'rectangle' };

  const zones: CmZone[] = [];
  const bad = (what: string, name: string) =>
    r.problems.push(`${what} "${name}" was not read: its shape is not one the framework uses.`);
  if (isObj(a.zones))
    for (const [name, z] of Object.entries(a.zones)) {
      const p = Array.isArray(z) ? z.map(num) : [];
      if (isPolygon(z)) zones.push({ name, kind: 'zone', shape: 'polygon', pts: z });
      else if (p.length === 4 && p.every((x) => x !== undefined))
        zones.push({
          name,
          kind: 'zone',
          shape: 'rect',
          pts: [
            [p[0]!, p[1]!],
            [p[2]!, p[3]!],
          ],
        });
      else if (p.length === 2 && p.every((x) => x !== undefined))
        zones.push({
          name,
          kind: 'zone',
          shape: 'rect',
          pts: [
            [p[0]!, 0],
            [p[1]!, h],
          ],
        });
      else bad('Zone', name);
    }
  if (isObj(a.enclosures))
    for (const [name, e] of Object.entries(a.enclosures)) {
      // {center, radius} in the framework; [x, y, radius] is also accepted there.
      const c = isObj(e) ? e.center : Array.isArray(e) ? e.slice(0, 2) : undefined;
      const rad = num(isObj(e) ? e.radius : Array.isArray(e) ? e[2] : undefined);
      if (isPt(c) && rad !== undefined)
        zones.push({ name, kind: 'exclude', shape: 'circle', pts: [c, [c[0] + rad, c[1]]] });
      else bad('Enclosure', name);
      if (isObj(e) && e.contents !== undefined)
        r.kept.push({ path: ['arena', 'enclosures', name, 'contents'], value: e.contents });
    }
  if (isObj(a.dividers))
    for (const [name, d] of Object.entries(a.dividers)) {
      if (isPolygon(d)) zones.push({ name, kind: 'exclude', shape: 'polygon', pts: d });
      else bad('Divider', name);
    }
  // Zones are in the position file's frame; with y down, flip them to the GUI's y-up frame.
  if (isObj(meta) && meta.y_increases === 'down' && positionUnit !== 'px')
    for (const z of zones) z.pts = z.pts.map(([x, y]) => [x, flipY(y, h)]);
  r.values.zones = zones;
}

const isPolygon = (z: unknown): z is Pt[] => Array.isArray(z) && z.length >= 3 && z.every(isPt);

function readMetadata(m: Obj, r: ConfigRead): void {
  const known = new Set<string>([
    'arena_shape',
    'body_length_cm',
    'stimuli',
    'y_increases',
    'label_roles',
  ]);
  for (const [key, field] of META_FIELDS) {
    known.add(key);
    const val = m[key];
    if (typeof val === 'string' || typeof val === 'number') r.values.meta[field] = val;
  }
  r.values.bodyLengthCm = num(m.body_length_cm);
  r.values.yDown = m.y_increases === 'down';
  if (Array.isArray(m.stimuli))
    r.values.stimuli = m.stimuli.filter(isObj).map((s) => ({
      name: String(s.name ?? ''),
      kind: String(s.kind ?? ''),
      label: str(s.label),
      durationS: num(s.duration_s),
      note: String(s.note ?? ''),
    }));
  if (isObj(m.label_roles))
    r.values.labelRoles = Object.fromEntries(
      Object.entries(m.label_roles).filter(
        (e): e is [string, LabelRole] => e[1] === 'measured' || e[1] === 'controlled',
      ),
    );
  for (const [k, val] of Object.entries(m)) {
    if (known.has(k)) r.read.push(`metadata.${k}`);
    else r.kept.push({ path: ['metadata', k], value: val });
  }
}

/** Put kept values back into an export. Their parents must already exist, except the optional top-level sections. */
export function restoreKept(out: Obj, kept: ConfigRead['kept']): void {
  for (const { path, value } of kept) {
    let o = out;
    let ok = true;
    for (let i = 0; i < path.length - 1 && ok; i++) {
      if (!isObj(o[path[i]])) {
        // Only sections where every key is optional can be created here.
        if (i === 0 && ['behavior', 'subjects', 'metadata'].includes(path[0])) o[path[i]] = {};
        else ok = false;
      }
      if (ok) o = o[path[i]] as Obj;
    }
    if (ok && !(path[path.length - 1] in o)) o[path[path.length - 1]] = value;
  }
}
