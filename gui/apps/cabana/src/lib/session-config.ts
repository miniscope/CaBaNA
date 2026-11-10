// The files CaBaNA writes for the Python framework: config.yaml (a session
// config that `cabana.loaders.load_session_dir` reads) and preprocess.yaml (the
// steps of a `cabana.Pipeline`, in the order they run). Names and fields are the
// framework's; the GUI's own words stay on screen.

import { Document, isMap, visit } from 'yaml';
import {
  arena,
  binGrid,
  cmPts,
  effectiveBin,
  pendingZones,
  positionTransform,
  sizeCm,
} from './arena.ts';
import { arenaProblem, configReport } from './config-import.ts';
import { regionNoticeProblem } from './region-notice.ts';
import { backgroundMeta } from './spatial-state.ts';
import { META_FIELDS, flipY, restoreKept, type CmZone } from './config-read.ts';
import { placeSettings } from './place-run.ts';
import { prep } from './preprocess.ts';
import { zoneShape } from './zone-occupancy.ts';
import { excludedFrames, keptFrames } from './position-corrections.ts';
import {
  annotationFixed,
  annotationResults,
  frameMapping,
  labelRegistry,
  labelRoles,
  loaded,
  onClear,
  onConfigLoaded,
  override,
  rejected,
  roleOf,
  sessionName,
  source,
  tol,
} from './store.ts';
import type { SlotId } from './slots.ts';
import { commonSteps, type CommonInput } from './spec/pipeline.ts';

type Obj = Record<string, unknown>;
const file = (id: SlotId) => loaded[id]?.name;
/** A flow-style YAML value (JSON is valid YAML). */
const flow = (v: unknown) => JSON.stringify(v);
const round = (v: number) => Math.round(v * 100) / 100;
const rounded = (z: CmZone) => z.pts.map((p) => p.map(round));

/** Zones in cm: the drawn ones, and any from a config still waiting for the arena outline. With y down they are written in the position file's frame. */
const cmZones = (): CmZone[] => {
  const h = sizeCm()[1];
  const back = source.yDown && source.positionUnit === 'cm';
  return [
    ...arena.zones.map((z) => ({ ...z, pts: cmPts(z) as [number, number][] })),
    ...(pendingZones() ?? []),
  ].map((z) =>
    back ? { ...z, pts: z.pts.map(([x, y]): [number, number] => [x, flipY(y, h)]) } : z,
  );
};

/** A rectangle's four corners; a polygon's own. */
function corners(z: CmZone): number[][] {
  const p = rounded(z);
  if (z.shape !== 'rect') return p;
  const [[x0, y0], [x1, y1]] = p;
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

const HEADER = [
  ' Session config made in CaBaNA, for cabana.loaders.load_session_dir. Paths are relative to this file.',
  " Arena coordinates are cm from the arena's lower left corner, y up. Zones are rectangles",
  ' [x0, y0, x1, y1] or polygons; enclosures and dividers are regions the animal cannot enter.',
  ' metadata holds settings from CaBaNA that the framework does not use.',
].join('\n');

/** Sections the framework may not read yet; the bridge leaves them out of the copy it runs. */
export type Section = 'metadata' | 'markers' | 'frame_labels';

/** The session config as the GUI's settings describe it, in the framework's layout. */
function configFromSettings(omit: Section[] = []): Obj {
  const cfg: Obj = {};
  if (sessionName()) cfg.name = sessionName();

  const layers = (
    [
      ['deconvolved', 'neural_deconvolved'],
      ['denoised', 'neural_denoised'],
      ['raw', 'neural_raw'],
    ] as const
  ).filter(([, id]) => file(id));
  if (layers.length) {
    const [kind, id] = layers[0];
    const neural: Obj = { file: file(id), kind };
    if (file('neural_timestamps')) neural.timestamps = file('neural_timestamps');
    else if (override.neuralFps) neural.fs = override.neuralFps;
    if (layers.length > 1)
      neural.alternatives = Object.fromEntries(layers.slice(1).map(([k, i]) => [k, file(i)]));
    cfg.neural = neural;
  }

  const beh: Obj = {};
  if (file('behavior_timestamps')) beh.timestamps = file('behavior_timestamps');
  if (source.clockOffsetS || source.clockScale !== 1)
    beh.clock = {
      offset_s: source.clockOffsetS,
      ...(source.clockScale !== 1 && { scale: source.clockScale }),
    };
  if (file('position'))
    beh.position = {
      file: file('position'),
      units: source.positionUnit,
      max_gap_s: prep.maxGapS,
      // Only written when there are some: a framework without exclude_frames rejects the key.
      ...(excludedFrames().length && { exclude_frames: excludedFrames() }),
    };
  if (file('head_orientation'))
    beh.head_orientation = { file: file('head_orientation'), offset_deg: arena.headOffset };
  const names = configReport()?.values.epochNames ?? {};
  const epochs = (
    [
      ['zone_annotations', 'zones', true],
      ['behavior_annotations', 'behavior', false],
    ] as const
  ).filter(([id]) => file(id));
  if (epochs.length)
    beh.epochs = Object.fromEntries(
      epochs.map(([id, name, exclusive]) => [
        names[id] ?? name,
        {
          file: file(id),
          exclusive,
          ...(annotationFixed().merge && { merge_gap_s: tol.mergeGapS }),
          ...(annotationFixed().drop && { min_duration_s: tol.minBoutS }),
        },
      ]),
    );
  if (file('time_markers') && !omit.includes('markers'))
    beh.markers = {
      [configReport()?.values.markersName ?? 'cues']: { file: file('time_markers') },
    };
  if (file('frame_labels') && !omit.includes('frame_labels')) {
    const m = frameMapping();
    beh.frame_labels = {
      [configReport()?.values.frameLabelsName ?? 'scoring']: {
        file: file('frame_labels'),
        frame_column: m.frameColumn,
        ...(m.binary.length && { binary: m.binary }),
        ...(m.categorical.length && { categorical: m.categorical }),
      },
    };
  }
  if (Object.keys(beh).length) cfg.behavior = beh;

  const [w, h] = sizeCm();
  const a: Obj = { size: [round(w), round(h)], units: 'cm' };
  const zs = cmZones();
  const zones = zs.filter((z) => z.kind === 'zone');
  const enclosures = zs.filter((z) => z.kind === 'exclude' && z.shape === 'circle');
  const dividers = zs.filter((z) => z.kind === 'exclude' && z.shape !== 'circle');
  if (zones.length) a.zones = Object.fromEntries(zones.map((z) => [z.name, zoneShape(z)]));
  if (enclosures.length)
    a.enclosures = Object.fromEntries(
      enclosures.map((z) => {
        const [c, e] = rounded(z);
        return [z.name, { center: c, radius: round(Math.hypot(e[0] - c[0], e[1] - c[1])) }];
      }),
    );
  if (dividers.length) a.dividers = Object.fromEntries(dividers.map((z) => [z.name, corners(z)]));
  cfg.arena = a;

  if (source.subjectId) cfg.subjects = { focal: source.subjectId };

  const meta: Obj = {};
  for (const [key, field] of META_FIELDS)
    if (source[field] !== '' && source[field] !== undefined) meta[key] = source[field];
  if (arena.shape === 'circle') meta.arena_shape = 'circle';
  if (source.yDown && source.positionUnit === 'cm') meta.y_increases = 'down';
  if (arena.bodyLength) meta.body_length_cm = round(arena.bodyLength);
  if (keptFrames().length) meta.position_kept_frames = keptFrames();
  const background = backgroundMeta();
  if (background) meta.arena_background = background;
  const stimuli = source.stimuli.filter((s) => s.name);
  if (stimuli.length)
    meta.stimuli = stimuli.map((s) => ({
      name: s.name,
      kind: s.kind,
      ...(s.label && { label: s.label }),
      ...(s.durationS && { duration_s: s.durationS }),
      ...(s.note && { note: s.note }),
    }));
  const roles = Object.fromEntries(
    [...new Set([...labelRegistry().map((e) => e.name), ...Object.keys(labelRoles)])].map((n) => [
      n,
      roleOf(n),
    ]),
  );
  if (Object.keys(roles).length) meta.label_roles = roles;
  if (Object.keys(meta).length && !omit.includes('metadata')) cfg.metadata = meta;

  restoreKept(cfg, configReport()?.kept ?? []);
  if (omit.includes('metadata')) delete cfg.metadata;
  return cfg;
}

// ---- Keeping an imported config

/** The loaded config as parsed, and what the GUI made of it once every file of the load was in place. */
let imported: { original: Obj; baseline: Obj } | undefined;
onConfigLoaded(() => {
  const original = configReport()?.original;
  imported = original && { original, baseline: configFromSettings() };
});
onClear(() => (imported = undefined));

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const base = (p: string) => p.split(/[\\/]/).pop();

/**
 * The original config with only what changed in the GUI since it was loaded written over it.
 * A field the GUI did not change keeps its original form (zone shapes, order, paths, units);
 * keys the GUI does not know are left as they were.
 */
export function patchConfig(original: unknown, baseline: unknown, current: unknown): unknown {
  if (isObj(original) && isObj(baseline) && isObj(current)) {
    const out: Obj = {};
    for (const [k, v] of Object.entries(original)) {
      if (k in current) out[k] = patchConfig(v, baseline[k], current[k]);
      else if (!(k in baseline)) out[k] = v; // not a key the GUI writes
      // otherwise the GUI wrote it when the config was loaded and has since removed it
    }
    // New in the GUI, or a GUI default the original left out that has since been changed.
    for (const [k, v] of Object.entries(current))
      if (!(k in original) && !same(baseline[k], v)) out[k] = v;
    return out;
  }
  if (same(baseline, current)) return original;
  // A file the GUI names by its base name keeps the original's folder.
  if (typeof original === 'string' && typeof current === 'string' && base(original) === current)
    return original;
  return current;
}

/** The config for the Download button: the imported one with the GUI's changes, or the GUI's own. */
export function exportedConfig(): Obj {
  const current = configFromSettings();
  return imported ? (patchConfig(imported.original, imported.baseline, current) as Obj) : current;
}

/** Set every input file path in `into` to the one in `from` (the name it was loaded under). */
function useLoadedPaths(into: unknown, from: unknown, underAlternatives = false): void {
  if (!isObj(into) || !isObj(from)) return;
  for (const [k, v] of Object.entries(from)) {
    if (typeof v === 'string' && (k === 'file' || k === 'timestamps' || underAlternatives))
      into[k] = v;
    else if (k !== 'metadata') useLoadedPaths(into[k], v, k === 'alternatives');
  }
}

/** Remove the value at a dotted path. */
function dropPath(o: Obj, path: string): void {
  const keys = path.split('.');
  let at: unknown = o;
  for (const k of keys.slice(0, -1)) at = isObj(at) ? at[k] : undefined;
  if (isObj(at)) delete at[keys.at(-1)!];
}

/**
 * The config the framework runs: the exported one with file paths as loaded (the bridge matches
 * files by name) and without keys the framework would reject. `omit` drops sections the
 * installed framework does not accept.
 */
export function buildSessionConfig(omit: Section[] = []): Obj {
  const current = configFromSettings(omit);
  if (!imported) return current;
  const cfg = JSON.parse(JSON.stringify(exportedConfig())) as Obj;
  useLoadedPaths(cfg, current);
  for (const path of configReport()?.unknown ?? []) dropPath(cfg, path);
  for (const s of omit) {
    dropPath(cfg, s === 'metadata' ? 'metadata' : `behavior.${s}`);
  }
  return cfg;
}

/** The session config as YAML. Lists of numbers are written on one line. */
export function sessionYaml(): string {
  const doc = new Document(exportedConfig());
  visit(doc, {
    Seq(_, node) {
      if (!node.items.some(isMap)) node.flow = true;
    },
  });
  doc.commentBefore = HEADER;
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}

/** The Preprocess page's values as the input of `commonSteps`. */
export function commonInput(): CommonInput {
  const labels = new Set(
    annotationResults()
      .filter((a) => a.id === 'behavior_annotations' && !a.error)
      .flatMap((a) => a.epochs.map((e) => e.label)),
  );
  return {
    positionUnit: source.positionUnit,
    positionTransform: positionTransform(),
    fillGapS: prep.fillGapS,
    posWindowS: prep.posWindowS,
    posMethod: prep.posMethod,
    speedWindowS: prep.speedWindowS,
    minSpeed: prep.minSpeed,
    eventSigmaS: prep.eventSigmaS,
    labelPadS: prep.labelPadS,
    paddedLabels: [...labels],
    hasArenaBox: !!binGrid(effectiveBin()),
    arenaProblem: arenaProblem() ?? regionNoticeProblem(),
    binCm: effectiveBin(),
    arenaCm: sizeCm(),
    rejected: [...rejected()],
  };
}

/** The preprocessing steps, in the order the framework runs them. */
export function preprocessYaml(): string {
  const { transforms, preprocess: steps, problems } = commonSteps(commonInput());

  const list = (name: string, items: Record<string, unknown>[]) =>
    items.length ? [`${name}:`, ...items.map((i) => `  - ${flow(i)}`)] : [`${name}: []`];
  const out = [
    '# preprocessing made in CaBaNA: framework steps, in the order they run',
    ...problems.map((p) => `# Incomplete: ${p}`),
    ...list('transforms', transforms),
    ...list('preprocess', steps),
  ];
  out.push(
    `# Place cells: minimum time per bin ${arena.minOccupancy} s for spatial information and stability, ${placeSettings.minOccFieldsS} s for place-field boundaries.`,
  );
  if (prep.traceSigmaS > 0)
    out.push(
      `# For the raw or denoised traces, run smooth_activity with sigma_s: ${prep.traceSigmaS} on that layer.`,
    );
  return out.join('\n') + '\n';
}

/** Save the session config as config.yaml. */
export function downloadConfig(): void {
  const url = URL.createObjectURL(new Blob([sessionYaml()], { type: 'text/yaml' }));
  Object.assign(document.createElement('a'), { href: url, download: 'config.yaml' }).click();
  URL.revokeObjectURL(url);
}
