// What the Data visualization timeline shows: the heat map source, behavior and zone rows, and which tracks are visible.

import { createMemo, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { arena, inZone, positionsCm, pxPerCm, toPx } from './arena.ts';
import { ZONE_COLORS } from './draw.ts';
import { lowerBound } from './framework.ts';
import {
  annotationResults,
  cameraTimes,
  deconvolved,
  denoisedTrace,
  frameTimes,
  positionResult,
  rawTrace,
  samplingRate,
} from './store.ts';
import { hoverT } from './viz.ts';
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
  ...labels().map((name, i) => ({
    key: `b:${name}`,
    kind: 'Behavior',
    name,
    color: PALETTE[i % PALETTE.length],
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
  return `${ht.toFixed(1)} s${where}${active.length ? `, behavior: ${active.join(', ')}` : ''}`;
};
