// The files CaBaNA writes for the Python framework: config.yaml (a session
// config that `cabana.loaders.load_session_dir` reads) and preprocess.yaml (the
// steps of a `cabana.Pipeline`, in the order they run). Names and fields are the
// framework's; the GUI's own words stay on screen.

import { Document, isMap, visit } from 'yaml';
import { arena, binGrid, cmPts, effectiveBin, pendingZones, sizeCm } from './arena.ts';
import { configReport } from './config-import.ts';
import { META_FIELDS, flipY, restoreKept, type CmZone } from './config-read.ts';
import { placeSettings } from './place-run.ts';
import { prep } from './preprocess.ts';
import {
  annotationFixed,
  annotationResults,
  frameMapping,
  labelRegistry,
  labelRoles,
  loaded,
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

/** The framework has rectangles and polygons; a circle becomes a 32-sided polygon. */
function zoneShape(z: CmZone): number[] | number[][] {
  const p = rounded(z);
  if (z.shape === 'rect') {
    const [a, b] = p;
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  }
  if (z.shape === 'circle') {
    const [c, e] = p;
    const r = Math.hypot(e[0] - c[0], e[1] - c[1]);
    return Array.from({ length: 32 }, (_, i) => [
      round(c[0] + r * Math.cos((2 * Math.PI * i) / 32)),
      round(c[1] + r * Math.sin((2 * Math.PI * i) / 32)),
    ]);
  }
  return p;
}

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

/**
 * The session config as a plain object in the framework's layout. `omit` drops sections the
 * installed framework does not accept, for the copy that is run; the downloaded file keeps them.
 */
export function buildSessionConfig(omit: Section[] = []): Obj {
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
    beh.position = { file: file('position'), units: source.positionUnit, max_gap_s: prep.maxGapS };
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

/** The session config as YAML. Lists of numbers are written on one line. */
export function sessionYaml(): string {
  const doc = new Document(buildSessionConfig());
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
    pxPerCm: source.pxPerCm,
    fillGapS: prep.fillGapS,
    posWindowS: prep.posWindowS,
    posMethod: prep.posMethod,
    speedWindowS: prep.speedWindowS,
    minSpeed: prep.minSpeed,
    eventSigmaS: prep.eventSigmaS,
    labelPadS: prep.labelPadS,
    paddedLabels: [...labels],
    hasArenaBox: !!binGrid(effectiveBin()),
    binCm: effectiveBin(),
    arenaCm: sizeCm(),
    rejected: [...rejected()],
  };
}

/** The preprocessing steps, in the order the framework runs them. */
export function preprocessYaml(): string {
  const { transforms, preprocess: steps } = commonSteps(commonInput());

  const list = (name: string, items: Record<string, unknown>[]) =>
    items.length ? [`${name}:`, ...items.map((i) => `  - ${flow(i)}`)] : [`${name}: []`];
  const out = [
    '# preprocessing made in CaBaNA: framework steps, in the order they run',
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
