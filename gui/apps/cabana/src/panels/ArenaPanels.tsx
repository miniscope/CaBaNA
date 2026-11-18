// What floats over the arena editor's canvas: the layer list, the pop-over for the selected shape,
// the zone occupancy chart, and the notes and check line along the bottom.

import { For, Show, type JSX } from 'solid-js';
import {
  arena,
  pendingZones,
  pxPerCm,
  regionGroup,
  setArena,
  sizeCm,
  toCm,
  zoneShare,
  type Zone,
} from '../lib/arena.ts';
import { copyName, moveRegion, regionBox, regionSizeText } from '../lib/arena-geometry.ts';
import type { ArenaEditor } from '../lib/arena-editor.ts';
import { ZONE_COLORS } from '../lib/draw.ts';
import { replacedSize } from '../lib/spatial-background.ts';
import {
  regionKey,
  spatialCheckList,
  spatialSnapshot,
  unverifiedZones,
  verifyZones,
} from '../lib/spatial-state.ts';
import { InfoTip } from './InfoTip.tsx';

const EXCLUDED = '#c62828';
export const zoneColor = (z: Pick<Zone, 'kind'>, i: number) =>
  z.kind === 'exclude' ? EXCLUDED : ZONE_COLORS[i % ZONE_COLORS.length];

/** Boundary and regions, each with its kind; a click selects it. */
export function LayerList(props: { ed: ArenaEditor }): JSX.Element {
  // The editor object is created once and does not change for this window.
  // eslint-disable-next-line solid/reactivity
  const ed = props.ed;
  const row = (id: 'boundary' | number, name: string, color: string, kind: string) => (
    <button
      type="button"
      class="cb-ae-layer"
      classList={{ 'cb-ae-layer--on': ed.selected() === id }}
      aria-pressed={ed.selected() === id}
      onClick={() => ed.setSelected(ed.selected() === id ? undefined : id)}
    >
      <i style={{ 'border-color': color }} />
      <span class="cb-ae-layer__name" title={name}>
        {name}
      </span>
      <span class="cb-ae-layer__kind">{kind}</span>
    </button>
  );
  return (
    <div class="cb-ae-layers" role="group" aria-label="Layers">
      {row('boundary', 'Boundary', '#1d9e75', arena.box ? 'shown' : 'not drawn')}
      <For each={arena.zones}>
        {(z, i) => row(i(), z.name, zoneColor(z, i()), z.kind === 'exclude' ? 'excluded' : 'zone')}
      </For>
    </div>
  );
}

/** Name, type, size and actions for the selected region, or the boundary's shape and size. */
export function ShapePopover(props: {
  ed: ArenaEditor;
  /** Where the shape is on screen, relative to the stage: left edge, top and right edge. */
  place: () => { left: number; top: number } | undefined;
}): JSX.Element {
  // The editor object is created once and does not change for this window.
  // eslint-disable-next-line solid/reactivity
  const ed = props.ed;
  const index = () => (typeof ed.selected() === 'number' ? (ed.selected() as number) : undefined);
  const zone = () => (index() === undefined ? undefined : arena.zones[index()!]);
  const taken = (name: string, kind: Zone['kind'], shape: string) =>
    arena.zones.some(
      (o, k) =>
        k !== index() &&
        o.name === name &&
        regionGroup(o.kind, o.shape) === regionGroup(kind, shape),
    ) ||
    (pendingZones() ?? []).some(
      (o) => o.name === name && regionGroup(o.kind, o.shape) === regionGroup(kind, shape),
    );
  const setField = <K extends 'name' | 'kind'>(key: K, value: Zone[K]) => {
    const z = zone();
    if (!z) return;
    const next = { ...z, [key]: value };
    if (taken(next.name, next.kind, next.shape)) return false;
    ed.edit(() => setArena('zones', index()!, key, value));
    return true;
  };
  const size = () => {
    const z = zone();
    if (!z) return undefined;
    const cm = z.pts.map((p) => toCm(p));
    return cm.every(Boolean) ? regionSizeText(z.shape, cm as [number, number][]) : undefined;
  };
  const duplicate = () => {
    const z = zone();
    if (!z) return;
    const name = copyName(z.name, (n) => taken(n, z.kind, z.shape));
    const off = 12 * (arena.box ? arena.box.w / 400 : 1);
    ed.edit(() => setArena('zones', (zs) => [...zs, { ...z, name, pts: moveRegion(z, off, off) }]));
    ed.setSelected(arena.zones.length - 1);
  };
  const remove = () => {
    const i = index();
    if (i === undefined) return;
    ed.edit(() => setArena('zones', (zs) => zs.filter((_, k) => k !== i)));
    ed.setSelected(undefined);
  };
  const unchecked = () => {
    const z = zone();
    return !!z && unverifiedZones().has(regionKey(z));
  };
  return (
    <Show when={ed.selected() !== undefined && props.place()}>
      {(at) => (
        <div
          class="cb-ae-pop"
          style={{ left: `${at().left}px`, top: `${at().top}px` }}
          role="group"
          aria-label="Selected shape"
        >
          <Show
            when={zone()}
            fallback={
              <>
                <b>Arena boundary</b>
                <label class="cb-ae-field">
                  <span>Shape</span>
                  <select
                    value={arena.shape}
                    onChange={(e) =>
                      ed.edit(() => setArena('shape', e.currentTarget.value as typeof arena.shape))
                    }
                  >
                    <option value="rectangle">Rectangle</option>
                    <option value="circle">Circle</option>
                  </select>
                </label>
                <div class="cb-ae-size">
                  {pxPerCm()
                    ? arena.shape === 'circle'
                      ? `diameter ${sizeCm()[0].toFixed(1)} cm`
                      : `${sizeCm()[0].toFixed(1)} × ${sizeCm()[1].toFixed(1)} cm`
                    : 'Set the scale to see the size in cm.'}
                </div>
              </>
            }
          >
            {(z) => (
              <>
                <b>{z().name}</b>
                <label class="cb-ae-field">
                  <span>Name</span>
                  <input
                    type="text"
                    value={z().name}
                    onChange={(e) => {
                      const v = e.currentTarget.value.trim();
                      if (!v || (v !== z().name && setField('name', v) === false))
                        e.currentTarget.value = z().name;
                    }}
                  />
                </label>
                <label class="cb-ae-field">
                  <span>Type</span>
                  <select
                    value={z().kind}
                    onChange={(e) => {
                      if (setField('kind', e.currentTarget.value as Zone['kind']) === false)
                        e.currentTarget.value = z().kind;
                    }}
                  >
                    <option value="zone">Zone</option>
                    <option value="exclude">Excluded region</option>
                  </select>
                </label>
                <div class="cb-ae-field">
                  <span>Shape</span>
                  <span>
                    {{ rect: 'Rectangle', circle: 'Circle', polygon: 'Polygon' }[z().shape]}
                  </span>
                </div>
                <div class="cb-ae-size">{size() ?? 'Set the scale to see the size in cm.'}</div>
                <Show when={unchecked()}>
                  <div class="cb-ae-note">
                    Read from config.yaml; placement not checked.{' '}
                    <button class="cb-link" onClick={() => verifyZones(regionKey(z()))}>
                      Placement checked
                    </button>
                  </div>
                </Show>
                <div class="cb-ae-actions">
                  <button class="btn-secondary btn-small" onClick={duplicate}>
                    Duplicate
                  </button>
                  <button class="btn-secondary btn-small" onClick={remove}>
                    Delete
                  </button>
                </div>
              </>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
}

/** Share of tracked frames in each zone and outside, from the same computation the analyses use. */
export function OccupancyChart(): JSX.Element {
  const outside = () => Math.max(0, 100 - zoneShare().reduce((a, z) => a + z.pct, 0));
  return (
    <section class="cb-ae-occ" aria-label="Zone occupancy">
      <div class="cb-ae-occ__head">
        <b>Zone occupancy</b>
        <InfoTip label="About zone occupancy">
          Share of the tracked position frames inside each zone, for the whole session, updated as
          zones are drawn or moved. A frame inside two zones counts for the first zone, as in the
          zone epochs the analyses use. Excluded regions are not zones and are not listed. Frames
          outside every zone are shown as outside.
        </InfoTip>
      </div>
      <Show
        when={zoneShare().length}
        fallback={
          <p class="cb-muted">Draw zones and set the scale to see the share of frames in each.</p>
        }
      >
        <For each={zoneShare()}>
          {(z) => (
            <div class="cb-ae-occ__row">
              <span title={z.name}>{z.name}</span>
              <span class="cb-ae-occ__track">
                <span
                  style={{
                    width: `${z.pct}%`,
                    background: ZONE_COLORS[z.index % ZONE_COLORS.length],
                  }}
                />
              </span>
              <span class="cb-ae-occ__pct">{z.pct.toFixed(0)}%</span>
            </div>
          )}
        </For>
        <div class="cb-ae-occ__row">
          <span class="cb-muted">outside</span>
          <span class="cb-ae-occ__track">
            <span style={{ width: `${outside()}%`, background: '#d4d4d4' }} />
          </span>
          <span class="cb-ae-occ__pct">{outside().toFixed(0)}%</span>
        </div>
        <p class="cb-ae-occ__note">
          Share of tracked frames, whole session. Updates as zones move.
        </p>
      </Show>
    </section>
  );
}

/** Open points that are not a check: regions waiting for an outline, unchecked placements, a new picture size. */
export function Notes(): JSX.Element {
  return (
    <>
      <Show when={pendingZones()?.length}>
        <div class="cb-ae-chip cb-ae-chip--warn">
          {pendingZones()!.length} regions from config.yaml wait for the arena outline and scale.
        </div>
      </Show>
      <Show when={spatialSnapshot().unverified}>
        <div class="cb-ae-chip cb-ae-chip--warn">
          {spatialSnapshot().unverified} regions from config.yaml are not checked against the
          picture.{' '}
          <button class="cb-link" onClick={() => verifyZones()}>
            Placement checked
          </button>
        </div>
      </Show>
      <Show when={replacedSize()}>
        <div class="cb-ae-chip cb-ae-chip--warn">
          The outline was drawn on a {replacedSize()!.join(' × ')} picture; this one is different.
          Check that it still matches the arena.
        </div>
      </Show>
    </>
  );
}

/** The one check kept on the canvas: how many tracked positions fall inside the arena. */
export function InsideCheck(): JSX.Element {
  const check = () => spatialCheckList().find((c) => c.key === 'position' && c.state !== 'info');
  const share = () => spatialSnapshot().insideShare;
  return (
    <Show when={check()}>
      {(c) => (
        <div
          class="cb-ae-chip"
          classList={{
            'cb-ae-chip--ok': c().state === 'ok',
            'cb-ae-chip--warn': c().state !== 'ok',
          }}
          title={c().text}
        >
          <span aria-hidden="true">{c().state === 'ok' ? '✓' : '!'}</span>{' '}
          <span class="cb-visually-hidden">{c().state === 'ok' ? 'Passed: ' : 'Check: '}</span>
          {c().state !== 'block' && share() !== undefined
            ? c().state === 'ok'
              ? `${(share()! * 100).toFixed(1)}% of tracked positions fall inside the arena`
              : c().text
            : c().text}
        </div>
      )}
    </Show>
  );
}

/** Where a pop-over goes: beside the right edge of the selected shape, kept inside the stage. */
export function popoverPlace(
  ed: ArenaEditor,
  canvas: HTMLCanvasElement | undefined,
  stage: HTMLElement | undefined,
) {
  const sel = ed.selected();
  if (sel === undefined || !canvas || !stage) return undefined;
  const b = sel === 'boundary' ? arena.box : arena.zones[sel] && regionBox(arena.zones[sel]);
  if (!b) return undefined;
  const c = canvas.getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  const sx = c.width / canvas.width;
  const sy = c.height / canvas.height;
  // The boundary's pop-over sits inside its upper right corner; a region's beside it.
  const right = c.left - s.left + (b.x + b.w) * sx;
  const left = c.left - s.left + b.x * sx;
  const top = c.top - s.top + b.y * sy;
  const W = 230;
  const x =
    sel === 'boundary'
      ? right - W - 12
      : right + 10 + W > s.width - 12
        ? left - W - 10
        : right + 10;
  return {
    left: Math.max(12, Math.min(x, s.width - W - 12)),
    top: Math.max(56, Math.min(top + (sel === 'boundary' ? 12 : 0), s.height - 230)),
  };
}
