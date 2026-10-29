// What the Data visualization timeline shows: the heat map source, behavior and zone rows, and which tracks are visible.

import { createMemo, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { arena, inZone, positionsCm, pxPerCm, toPx } from './arena.ts';
import { ZONE_COLORS } from './draw.ts';
import { lowerBound } from './framework.ts';
import {
  annotationResults,
  cameraTimes,
  cameraClock,
  deconvolved,
  denoisedTrace,
  frameLabelsOnCamera,
  frameTimes,
  labelRegistry,
  markerFile,
  neuralSpan,
  positionResult,
  rawTrace,
  samplingRate,
} from './store.ts';
import { runsOf } from './frame-labels.ts';
import { hoverT, win } from './viz.ts';
import { PALETTE } from '../panels/BehaviorQc.tsx';

export type Source = 'raw' | 'denoised' | 'events';
export const SOURCE_LABEL: Record<Source, string> = {
  raw: 'raw fluorescence',
  denoised: 'denoised trace',
  events: 'deconvolved events',
};
export const SOURCE_COLOR: Record<Source, string> = {
  raw: '#8a97a8',
  denoised: '#2171b5',
  events: '#e09800',
};

export const matrixOf = (s: Source) =>
  s === 'raw' ? rawTrace() : s === 'denoised' ? denoisedTrace() : deconvolved();
export const sources = () => (['denoised', 'raw', 'events'] as Source[]).filter((s) => matrixOf(s));

/** Frame times of the neural data; from the sampling rate when there is no timestamps file. */
export const neuralT = createMemo<ArrayLike<number> | undefined>(() => {
  const frames = (rawTrace() ?? denoisedTrace() ?? deconvolved())?.frames ?? 0;
  return (
    frameTimes() ??
    (frames ? Array.from({ length: frames }, (_, i) => i / (samplingRate() ?? 30)) : undefined)
  );
});

export const [heatSrc, setHeatSrc] = createSignal<Source | undefined>();
export const heat = () => (heatSrc() && matrixOf(heatSrc()!) ? heatSrc()! : sources()[0]);

/** Each cell's own color scale for the heat map: its 5th to 99.5th percentile over the session. */
export const heatScale = createMemo(() => {
  const s = heat();
  const m = s && matrixOf(s);
  if (!m) return undefined;
  const lo = new Float32Array(m.cells);
  const hi = new Float32Array(m.cells);
  for (let c = 0; c < m.cells; c++) {
    const row = Float32Array.from(m.data.subarray(c * m.frames, (c + 1) * m.frames)).sort();
    lo[c] = row[Math.floor(row.length * 0.05)];
    hi[c] = row[Math.floor(row.length * 0.995)];
  }
  return { lo, hi };
});

export const epochs = createMemo(() =>
  annotationResults().flatMap((a) => (a.error ? [] : a.epochs.filter((e) => e.stop > e.start))),
);
const labels = createMemo(() => [...new Set(epochs().map((e) => e.label))]);

/** One color per label name across epochs, markers and frame labels; epoch labels come first, so their colors are unchanged. */
export const colorOf = (name: string) => {
  const names = [...new Set([...labels(), ...labelRegistry().map((e) => e.name)])];
  return PALETTE[Math.max(0, names.indexOf(name)) % PALETTE.length];
};

/** Time markers inside the recording; the ones outside are listed in Load preview and drawn nowhere. */
export const markersInView = createMemo(() => {
  const span = neuralSpan();
  const all = markerFile()?.markers ?? [];
  return span ? all.filter((m) => m.timeS >= span[0] && m.timeS <= span[1]) : all;
});

/** The marker nearest `t` within `tol` seconds, for the hover label. */
export function markerNear(t: number, tol: number) {
  let best: { label: string; timeS: number } | undefined;
  for (const m of markersInView())
    if (Math.abs(m.timeS - t) <= tol && (!best || Math.abs(m.timeS - t) < Math.abs(best.timeS - t)))
      best = m;
  return best;
}

/** One band row per frame-label column: runs of 1 for a binary column, one colored run per value for a category. */
export const frameBands = createMemo(() => {
  const j = frameLabelsOnCamera();
  const t = cameraClock();
  if (!j || !t) return [];
  const bands: {
    key: string;
    name: string;
    kind: 'binary' | 'category';
    runs: { label: string; color: string; runs: [number, number][] }[];
  }[] = [];
  for (const [name, v] of Object.entries(j.binary))
    bands.push({
      key: `fb:${name}`,
      name,
      kind: 'binary',
      runs: [{ label: name, color: colorOf(name), runs: runsOf(t, (i) => v[i] === 1) }],
    });
  for (const [name, v] of Object.entries(j.categorical))
    bands.push({
      key: `fc:${name}`,
      name,
      kind: 'category',
      runs: [...new Set(v.filter((x): x is string => x !== null))].map((label) => ({
        label,
        color: colorOf(label),
        runs: runsOf(t, (i) => v[i] === label),
      })),
    });
  return bands;
});

const zones = createMemo(() => {
  const pos = positionsCm();
  if (!pxPerCm() || !arena.box || !pos.x.length)
    return [] as { name: string; color: string; runs: [number, number][] }[];
  const t = cameraTimes();
  if (!t) return [];
  return arena.zones
    .map((z, i) => ({ z, i }))
    .filter(({ z }) => z.kind === 'zone')
    .map(({ z, i }) => {
      const runs: [number, number][] = [];
      let start: number | undefined;
      for (let k = 0; k < t.length; k++) {
        const p = toPx([pos.x[k], pos.y[k]]);
        const inside = !!p && Number.isFinite(pos.x[k]) && inZone(p, z);
        if (inside && start === undefined) start = t[k];
        if (!inside && start !== undefined) {
          runs.push([start, t[k]]);
          start = undefined;
        }
      }
      if (start !== undefined) runs.push([start, t[t.length - 1]]);
      return { name: z.name, color: ZONE_COLORS[i % ZONE_COLORS.length], runs };
    });
});

export const pos = () => {
  const p = positionResult();
  return p && 'x' in p && cameraTimes() ? p : undefined;
};

/** One row per behavior label, then one per zone. */
export const rows = createMemo(() => [
  ...labels().map((name) => ({
    key: `b:${name}`,
    kind: 'Behavior',
    name,
    color: colorOf(name),
    runs: epochs()
      .filter((e) => e.label === name)
      .map((e) => [e.start, e.stop] as [number, number]),
  })),
  ...zones().map((z) => ({ key: `z:${z.name}`, kind: 'Zone', ...z })),
]);

// Tracks the user turned on or off. Without a choice, the first behavior and zone rows that fit are shown.
const [choice, setChoice] = createStore<Record<string, boolean>>({});
const fitRows = () => (innerHeight >= 760 ? 6 : 4);
export const isOn = (key: string, rank?: number) =>
  choice[key] ?? (rank === undefined || rank < fitRows());
export { setChoice };
export const shownRows = createMemo(() => rows().filter((r, i) => isOn(r.key, i)));
export const hiddenCount = () =>
  rows().length -
  shownRows().length +
  (['position', 'speed'] as const).filter((k) => pos() && !isOn(k)).length;

/** The element the Tracks popover is anchored to, when it is open. */
export const [tracksAnchor, setTracksAnchor] = createSignal<HTMLElement>();
export const openTracks = (el: HTMLElement) => setTracksAnchor((a) => (a === el ? undefined : el));

/** Frame-label values at time `t`: binary labels that are 1 and the category value. */
function frameLabelsAt(t: number): string[] {
  const j = frameLabelsOnCamera();
  const ct = cameraClock();
  if (!j || !ct) return [];
  const i = Math.min(lowerBound(ct, t), ct.length - 1);
  return [
    ...Object.entries(j.binary).flatMap(([n, v]) => (v[i] === 1 ? [n] : [])),
    ...Object.values(j.categorical).flatMap((v) => (v[i] ? [v[i]!] : [])),
  ];
}

export const readout = () => {
  const ht = hoverT();
  if (ht === undefined) return undefined;
  const active = epochs()
    .filter((e) => e.start <= ht && ht <= e.stop)
    .map((e) => e.label);
  const ct = cameraTimes();
  const p = pos();
  let where = '';
  if (ct && p) {
    const i = Math.min(lowerBound(ct, ht), ct.length - 1);
    if (Number.isFinite(p.x[i])) where = `, position (${p.x[i].toFixed(1)}, ${p.y[i].toFixed(1)})`;
  }
  const mk = markerNear(ht, (win()[1] - win()[0]) / 200);
  const frame = frameLabelsAt(ht);
  return `${ht.toFixed(1)} s${where}${active.length ? `, behavior: ${active.join(', ')}` : ''}${frame.length ? `, frame labels: ${frame.join(', ')}` : ''}${mk ? `, marker: ${mk.label} (${mk.timeS.toFixed(2)} s)` : ''}`;
};
