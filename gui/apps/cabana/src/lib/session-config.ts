// The files CaBaNA writes for the Python framework: config.yaml (a session
// config that `cabana.loaders.load_session_dir` reads) and preprocess.yaml (the
// steps of a `cabana.Pipeline`, in the order they run). Names and fields are the
// framework's; the GUI's own words stay on screen.

import { arena, cmPts, effectiveBin, sizeCm, type Zone } from './arena.ts';
import { placeSettings } from './place-run.ts';
import { prep } from './preprocess.ts';
import {
  annotationFixed,
  annotationResults,
  loaded,
  override,
  positionSteps,
  rejected,
  sessionName,
  source,
  tol,
} from './store.ts';
import type { SlotId } from './slots.ts';

const file = (id: SlotId) => loaded[id]?.name;
/** A flow-style YAML value (JSON is valid YAML). */
const flow = (v: unknown) => JSON.stringify(v);
const round = (v: number) => Math.round(v * 100) / 100;
const pts = (z: Zone) => cmPts(z).map((p) => p.map(round));

/** The framework has rectangles and polygons; a circle becomes a 32-sided polygon. */
function zoneShape(z: Zone): number[] | number[][] {
  const p = pts(z);
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
function corners(z: Zone): number[][] {
  const p = pts(z);
  if (z.shape !== 'rect') return p;
  const [[x0, y0], [x1, y1]] = p;
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/** The session config: which file is what, the clocks, and the arena. */
export function sessionYaml(): string {
  const out = ['# session config made in CaBaNA. Paths are relative to this file.'];
  if (sessionName()) out.push(`name: ${flow(sessionName())}`);

  const layers = (
    [
      ['deconvolved', 'neural_deconvolved'],
      ['denoised', 'neural_denoised'],
      ['raw', 'neural_raw'],
    ] as const
  ).filter(([, id]) => file(id));
  if (layers.length) {
    const [kind, id] = layers[0];
    out.push('neural:', `  file: ${flow(file(id))}`, `  kind: ${kind}`);
    if (file('neural_timestamps')) out.push(`  timestamps: ${flow(file('neural_timestamps'))}`);
    else if (override.neuralFps) out.push(`  fs: ${override.neuralFps}`);
    else out.push('  # fs: give the miniscope frame rate when there is no timestamps file');
    if (layers.length > 1)
      out.push(
        `  alternatives: ${flow(Object.fromEntries(layers.slice(1).map(([k, i]) => [k, file(i)])))}`,
      );
  } else out.push('# neural: add a traces file in the Load step');

  const beh: string[] = [];
  if (file('behavior_timestamps')) beh.push(`  timestamps: ${flow(file('behavior_timestamps'))}`);
  if (source.clockOffsetS) beh.push(`  clock: {offset_s: ${source.clockOffsetS}}`);
  if (file('position'))
    beh.push(
      '  position:',
      `    file: ${flow(file('position'))}`,
      `    units: ${source.positionUnit}`,
      '    max_gap_s: 0.5',
    );
  if (file('head_orientation'))
    beh.push(
      '  head_orientation:',
      `    file: ${flow(file('head_orientation'))}`,
      `    offset_deg: ${arena.headOffset}`,
    );
  const epochs = (
    [
      ['zone_annotations', 'zones', true],
      ['behavior_annotations', 'behavior', false],
    ] as const
  ).filter(([id]) => file(id));
  if (epochs.length) {
    beh.push('  epochs:');
    for (const [id, name, exclusive] of epochs) {
      const e: Record<string, unknown> = { file: file(id), exclusive };
      if (annotationFixed().merge) e.merge_gap_s = tol.mergeGapS;
      if (annotationFixed().drop) e.min_duration_s = tol.minBoutS;
      beh.push(`    ${name}: ${flow(e)}`);
    }
  }
  if (beh.length) out.push('behavior:', ...beh);

  const [w, h] = sizeCm();
  out.push('arena:', `  size: [${round(w)}, ${round(h)}]`, '  units: cm');
  const named = (kind: Zone['kind']) => arena.zones.filter((z) => z.kind === kind);
  if (named('zone').length)
    out.push(
      '  zones:  # cm from the arena lower left corner; rectangle [x0, y0, x1, y1] or polygon',
      ...named('zone').map((z) => `    ${flow(z.name)}: ${flow(zoneShape(z))}`),
    );
  const enclosures = named('exclude').filter((z) => z.shape === 'circle');
  if (enclosures.length)
    out.push(
      '  enclosures:  # regions the animal cannot enter',
      ...enclosures.map((z) => {
        const [c, e] = pts(z);
        return `    ${flow(z.name)}: {center: ${flow(c)}, radius: ${round(Math.hypot(e[0] - c[0], e[1] - c[1]))}}`;
      }),
    );
  const walls = named('exclude').filter((z) => z.shape !== 'circle');
  if (walls.length)
    out.push(
      '  dividers:  # other excluded regions, as polygons. The framework keeps these but does not use them yet',
      ...walls.map((z) => `    ${flow(z.name)}: ${flow(corners(z))}`),
    );
  const info = [
    ['subject', source.subjectId],
    ['species', source.species],
    ['brain region', source.brainRegion],
    ['group', source.group],
    ['date', source.sessionDate],
    ['miniscope', source.device],
    ['tracked body part', source.bodyPart],
    ['likelihood threshold', source.likelihoodMin],
    ...source.stimuli
      .filter((s) => s.name)
      .map((s) => ['stimulus', `${s.name} (${s.kind}${s.durationS ? `, ${s.durationS} s` : ''})`]),
  ].filter(([, v]) => v !== '' && v !== undefined);
  if (info.length)
    out.push(
      `# Set in CaBaNA, with no field in the framework: ${info.map(([k, v]) => `${k} ${v}`).join('; ')}.`,
    );
  const extra = [
    arena.bodyLength && `body length ${round(arena.bodyLength)} cm (nose tip to tail base)`,
    `minimum time per bin ${arena.minOccupancy} s (spatial information and stability), ${placeSettings.minOccFieldsS} s (place-field boundaries)`,
  ].filter(Boolean);
  out.push(`# Set in CaBaNA, with no field in the framework: ${extra.join('; ')}.`);
  return out.join('\n') + '\n';
}

/** The preprocessing steps, in the order the framework runs them. */
export function preprocessYaml(): string {
  const transforms: Record<string, unknown>[] = [...positionSteps()];
  if (source.positionUnit === 'px')
    transforms.unshift({
      name: 'arena_transform',
      signals: [''],
      scale: round(1 / source.pxPerCm),
      // The framework names the unit mm after a scale; the values here are cm.
    });
  if (prep.posWindowS > 0)
    transforms.push({
      name: 'smooth_signal',
      signal: ['x', 'y'],
      method: prep.posMethod,
      window_s: prep.posWindowS,
    });
  transforms.push({ name: 'speed', signals: ['x', 'y'], window_s: prep.speedWindowS });
  if (arena.box)
    transforms.push({ name: 'bin_grid', signals: ['x', 'y'], bin_size: effectiveBin() });

  const steps: Record<string, unknown>[] = [];
  if (rejected().size)
    steps.push({
      name: 'select_cells',
      exclude_ids: [...rejected()].sort((a, b) => a - b).map(String),
    });
  if (prep.eventSigmaS > 0) steps.push({ name: 'smooth_activity', sigma_s: prep.eventSigmaS });
  if (prep.minSpeed > 0)
    steps.push({ name: 'speed_threshold', signal: 'speed', min_speed: prep.minSpeed });
  if (prep.labelPadS > 0) {
    const labels = new Set(
      annotationResults()
        .filter((a) => a.id === 'behavior_annotations' && !a.error)
        .flatMap((a) => a.epochs.map((e) => e.label)),
    );
    for (const l of labels) {
      steps.push({
        name: 'mask_from_state',
        states: 'behavior',
        include: [l],
        output: `${l}_padded`,
      });
      steps.push({ name: 'clean_mask', mask: `${l}_padded`, dilate_s: prep.labelPadS });
    }
  }

  const list = (name: string, items: Record<string, unknown>[]) =>
    items.length ? [`${name}:`, ...items.map((i) => `  - ${flow(i)}`)] : [`${name}: []`];
  const out = [
    '# preprocessing made in CaBaNA: framework steps, in the order they run',
    ...list('transforms', transforms),
    ...list('preprocess', steps),
  ];
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
