import { createEffect, createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import {
  type Pt,
  arena,
  binGrid,
  bumpFrame,
  effectiveBin,
  frame,
  frameVersion,
  occupancy,
  positionsCm,
  pxPerCm,
  setArena,
  setFrame,
  sizeCm,
  zoneShare,
} from '../lib/arena.ts';
import { backgroundFrame, blankFrame, loadFrameFile, seekVideo } from '../lib/frame.ts';
import {
  ZONE_COLORS,
  arenaOutline,
  drawZones,
  shapePath as drawShape,
  tracePath,
} from '../lib/draw.ts';
import { Trajectory } from './Trajectory.tsx';
import { Note } from './parts.tsx';
import { EXAMPLES, exampleMedia, loaded, setSource, source } from '../lib/store.ts';

type Tool = 'none' | 'arena' | 'distance' | 'zone' | 'animal';

/** Describe the arena on a picture: its outline, scale, zones and the animal's size. */
export function SpatialSetup(): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  const [tool, setTool] = createSignal<Tool>('none');
  const [zoneShape, setZoneShape] = createSignal<
    'rect' | 'square' | 'circle' | 'polygon' | 'freehand'
  >('rect');
  const [zoneKind, setZoneKind] = createSignal<'zone' | 'exclude'>('zone');
  const [zoneName, setZoneName] = createSignal('');
  const [drag, setDrag] = createSignal<[Pt, Pt] | undefined>();
  const [poly, setPoly] = createSignal<Pt[]>([]);
  const [clicks, setClicks] = createSignal<Pt[]>([]);
  const [showBins, setShowBins] = createSignal(false);
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal('');
  const [t, setT] = createSignal(0);
  const [viewTab, setViewTab] = createSignal<'top' | 'tracking' | 'zones'>('top');
  const [hover, setHover] = createSignal<
    { i: number; j: number; sec?: number; open: boolean } | undefined
  >();

  /** The bin grid for the current bin size, and the seconds the animal spent in each bin. */
  const binData = createMemo(() => {
    const g = pxPerCm() && arena.box ? binGrid(effectiveBin()) : undefined;
    if (!g) return undefined;
    const occ = positionsCm().x.length ? occupancy(g) : undefined;
    // The darkest blue is the time at the 95th percentile of the open bins.
    const times = occ ? [...occ].filter((_, i) => g.open[i]).sort((p, q) => p - q) : [];
    return { grid: g, occ, top: times[Math.floor(times.length * 0.95)] || 1 };
  });

  // ---- the picture
  async function onFile(file: File | undefined) {
    if (!file) return;
    setError('');
    setBusy('Loading…');
    try {
      const f = await loadFrameFile(file);
      setFrame(f);
      setArena('box', undefined);
      setArena('line', undefined);
      setTool('arena');
      if (f.kind === 'video') {
        setBusy('Finding the empty arena…');
        await backgroundFrame(f);
        bumpFrame((v) => v + 1);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy('');
  }

  function startBlank() {
    const [w, h] = sizeCm();
    const W = 720;
    const s = (W - 60) / w;
    setFrame(blankFrame(W, Math.round(h * s + 60)));
    setArena('scaleMode', 'arena');
    setArena('box', { x: 30, y: 30, w: w * s, h: h * s });
  }

  async function scrub(v: number) {
    const f = frame();
    if (!f?.video) return;
    setT(v);
    await seekVideo(f, v);
    bumpFrame((n) => n + 1);
  }

  async function showBackground() {
    const f = frame();
    if (!f?.video) return;
    setBusy('Finding the empty arena…');
    await backgroundFrame(f);
    bumpFrame((n) => n + 1);
    setBusy('');
  }

  // ---- drawing on the picture
  const pt = (e: MouseEvent): Pt => {
    const r = canvas!.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width) * canvas!.width,
      ((e.clientY - r.top) / r.height) * canvas!.height,
    ];
  };

  const dragTool = () =>
    tool() === 'arena' || (tool() === 'zone' && ['rect', 'square', 'circle'].includes(zoneShape()));
  const freehand = () => tool() === 'zone' && zoneShape() === 'freehand';

  /** The far corner of a square drawn from corner a: equal sides, in the direction of the drag. */
  const squareCorner = (a: Pt, b: Pt): Pt => {
    const side = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    return [a[0] + Math.sign(b[0] - a[0] || 1) * side, a[1] + Math.sign(b[1] - a[1] || 1) * side];
  };

  function addZone(pts: Pt[]) {
    const n = arena.zones.length + 1;
    const name = zoneName().trim() || (zoneKind() === 'exclude' ? `excluded ${n}` : `zone ${n}`);
    const kind = zoneKind();
    const drawn = zoneShape();
    const shape = drawn === 'square' ? 'rect' : drawn === 'freehand' ? 'polygon' : drawn;
    setArena('zones', (zs) => [...zs, { name, kind, shape, pts }]);
    setZoneName('');
    setPoly([]);
  }

  function commitDrag(a: Pt, b: Pt) {
    if (tool() === 'arena') {
      const w = Math.abs(b[0] - a[0]);
      const h = Math.abs(b[1] - a[1]);
      const side = Math.max(w, h);
      const x = Math.min(a[0], b[0]);
      const y = Math.min(a[1], b[1]);
      setArena('box', arena.shape === 'circle' ? { x, y, w: side, h: side } : { x, y, w, h });
    } else if (tool() === 'zone') {
      addZone([a, zoneShape() === 'square' ? squareCorner(a, b) : b]);
    }
    setTool('none');
  }

  function onClick(e: MouseEvent) {
    const p = pt(e);
    if (tool() === 'zone' && zoneShape() === 'polygon') setPoly((q) => [...q, p]);
    if (tool() === 'distance' || tool() === 'animal') {
      const c = [...clicks(), p];
      if (c.length < 2) return setClicks(c);
      setClicks([]);
      if (tool() === 'distance') setArena('line', [c[0], c[1]]);
      else setArena('bodyLine', [c[0], c[1]]);
      setTool('none');
    }
  }

  // The measured animal length follows the scale.
  createEffect(() => {
    const s = pxPerCm();
    const l = arena.bodyLine;
    if (s && l) setArena('bodyLength', Math.hypot(l[0][0] - l[1][0], l[0][1] - l[1][1]) / s);
  });

  // ---- render
  createEffect(() => {
    const f = frame();
    frameVersion();
    const c = canvas;
    const ctx = c?.getContext('2d');
    if (!f || !c || !ctx) return;
    c.width = f.canvas.width;
    c.height = f.canvas.height;
    const lw = Math.max(2, c.width / 400);
    const fontPx = Math.max(12, c.width / 50);
    ctx.drawImage(f.canvas, 0, 0);
    const b = arena.box;
    const path = (pts: Pt[], close = true) => tracePath(ctx, pts, close);
    const shapePath = (z: { shape: string; pts: Pt[] }) => drawShape(ctx, z);
    const arenaPath = () => arenaOutline(ctx, b, arena.shape);

    // bins, and the time the animal spent in each, inside the arena
    const bd = showBins() ? binData() : undefined;
    const grid = bd?.grid;
    const occ = bd?.occ;
    if (grid && b) {
      const s = pxPerCm()!;
      const top = bd!.top;
      ctx.save();
      arenaPath();
      ctx.clip();
      for (let j = 0; j < grid.ny; j++)
        for (let i = 0; i < grid.nx; i++) {
          const x = b.x + i * grid.bin * s;
          const y = b.y + b.h - (j + 1) * grid.bin * s;
          const k = j * grid.nx + i;
          if (!grid.open[k]) {
            ctx.fillStyle = 'rgba(90,90,90,0.5)';
            ctx.fillRect(x, y, grid.bin * s, grid.bin * s);
          } else if (occ) {
            ctx.fillStyle =
              occ[k] < arena.minOccupancy
                ? 'rgba(215,50,50,0.35)'
                : `rgba(33,113,181,${0.08 + 0.4 * Math.min(1, occ[k] / top)})`;
            ctx.fillRect(x, y, grid.bin * s, grid.bin * s);
          }
        }
      const cell = grid.bin * s;
      if (occ && cell >= 30) {
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${Math.min(14, cell / 3)}px sans-serif`;
        for (let j = 0; j < grid.ny; j++)
          for (let i = 0; i < grid.nx; i++)
            if (grid.open[j * grid.nx + i])
              ctx.fillText(
                occ[j * grid.nx + i].toFixed(1),
                b.x + (i + 0.5) * cell,
                b.y + b.h - (j + 0.5) * cell,
              );
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= grid.nx; i++) {
        ctx.moveTo(b.x + i * grid.bin * s, b.y);
        ctx.lineTo(b.x + i * grid.bin * s, b.y + b.h);
      }
      for (let j = 0; j <= grid.ny; j++) {
        ctx.moveTo(b.x, b.y + b.h - j * grid.bin * s);
        ctx.lineTo(b.x + b.w, b.y + b.h - j * grid.bin * s);
      }
      ctx.stroke();
      ctx.restore();
    }

    if (b) {
      arenaPath();
      ctx.strokeStyle = '#2171b5';
      ctx.lineWidth = lw;
      ctx.stroke();
    }
    drawZones(ctx, arena.zones, lw, fontPx);
    const seg = (l: [Pt, Pt] | undefined, col: string, label?: string) => {
      if (!l) return;
      path(l, false);
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.stroke();
      if (label) {
        ctx.fillStyle = col;
        ctx.font = `${fontPx}px sans-serif`;
        ctx.fillText(label, (l[0][0] + l[1][0]) / 2 + 6, (l[0][1] + l[1][1]) / 2 - 6);
      }
    };
    seg(arena.line, '#e09800', `${arena.lineCm} cm`);
    seg(
      arena.bodyLine,
      '#8e44ad',
      arena.bodyLength ? `${arena.bodyLength.toFixed(1)} cm` : undefined,
    );

    // the shape being drawn
    ctx.strokeStyle = '#e09800';
    ctx.lineWidth = lw;
    const d = drag();
    if (d) {
      const circle = tool() === 'arena' ? arena.shape === 'circle' : zoneShape() === 'circle';
      shapePath({
        shape: circle ? 'circle' : 'rect',
        pts:
          tool() === 'arena' && circle
            ? [[(d[0][0] + d[1][0]) / 2, (d[0][1] + d[1][1]) / 2], d[1]]
            : tool() === 'zone' && zoneShape() === 'square'
              ? [d[0], squareCorner(d[0], d[1])]
              : d,
      });
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (poly().length) {
      path(poly(), false);
      ctx.stroke();
    }
    ctx.fillStyle = '#e09800';
    clicks().forEach((p) => ctx.fillRect(p[0] - 3, p[1] - 3, 6, 6));
  });

  const onHover = (e: MouseEvent) => {
    const d = binData();
    const b = arena.box;
    const s = pxPerCm();
    if (!d || !b || !s) return setHover(undefined);
    const p = pt(e);
    const [x, y] = [(p[0] - b.x) / s, (b.y + b.h - p[1]) / s];
    const [i, j] = [Math.floor(x / d.grid.bin), Math.floor(y / d.grid.bin)];
    if (i < 0 || j < 0 || i >= d.grid.nx || j >= d.grid.ny) return setHover(undefined);
    setHover({ i, j, sec: d.occ?.[j * d.grid.nx + i], open: d.grid.open[j * d.grid.nx + i] });
  };

  const num =
    (set: (v: number) => void, min = 0) =>
    (e: Event & { currentTarget: HTMLInputElement }) =>
      set(Math.max(min, +e.currentTarget.value || min));

  const toolBtn = (id: Tool, label: string) => (
    <button
      class="btn-small"
      classList={{ 'btn-primary': tool() === id, 'btn-secondary': tool() !== id }}
      onClick={() => {
        setTool(tool() === id ? 'none' : id);
        setClicks([]);
        setPoly([]);
      }}
    >
      {label}
    </button>
  );

  const hint = () =>
    ({
      none: '',
      arena:
        arena.shape === 'circle'
          ? 'Drag from one side of the arena to the other.'
          : 'Drag from one corner of the arena to the opposite corner.',
      distance: 'Click the two ends of a distance you know, such as a ruler or a marked length.',
      zone:
        zoneShape() === 'polygon'
          ? 'Click each corner. Double-click, or press Finish, to close the shape.'
          : zoneShape() === 'freehand'
            ? 'Press and hold, then draw the outline. Let go to close the shape.'
            : zoneShape() === 'circle'
              ? 'Drag from the center to the edge.'
              : 'Drag from one corner to the opposite corner.',
      animal: 'Click the tip of the nose, then the base of the tail.',
    })[tool()];

  return (
    <div class="cb-panel cb-panel--wide">
      <p class="cb-lead">
        Describe the arena so later steps can place the animal in it: its outline, its scale and its
        zones. If you loaded a config file you can skip this. Nothing here is required.
      </p>
      <Show when={loaded.config?.summary && loaded.config.size > 0}>
        <div class="cb-note">
          Arena settings loaded from {loaded.config!.name}: {loaded.config!.summary}
        </div>
      </Show>
      <div class="cb-arena-grid">
        <div class="cb-arena-controls">
          <section class="cb-group">
            <h3>1. Picture of the arena</h3>
            <Note>
              Upload one frame from the behavior camera, or a video. For a video, CaBaNA builds a
              picture of the empty arena from the median over many frames, since the animal is in a
              different place in each one. Drag the slider to a frame with the animal in it to
              measure the animal.
            </Note>
            <Show when={exampleMedia()}>
              <div class="cb-note">
                Example loaded: {EXAMPLES.find((x) => x.id === exampleMedia()!.id)?.note}
                <div class="cb-controls">
                  <Show when={exampleMedia()!.frame}>
                    <button
                      class="btn-secondary btn-small"
                      onClick={() => void onFile(exampleMedia()!.frame)}
                    >
                      Use the example picture
                    </button>
                  </Show>
                  <Show when={exampleMedia()!.video}>
                    <button
                      class="btn-secondary btn-small"
                      onClick={() => void onFile(exampleMedia()!.video)}
                    >
                      Use the example video
                    </button>
                  </Show>
                </div>
              </div>
            </Show>
            <div class="cb-controls">
              <label class="btn-secondary btn-small cb-file">
                Choose image or video
                <input
                  type="file"
                  hidden
                  accept="image/*,video/*"
                  onChange={(e) => void onFile(e.currentTarget.files?.[0])}
                />
              </label>
              <button class="btn-secondary btn-small" onClick={startBlank}>
                No picture: use a blank arena
              </button>
            </div>
            <Show when={busy()}>
              <div class="cb-muted">{busy()}</div>
            </Show>
            <Show when={error()}>
              <div class="cb-error">{error()}</div>
            </Show>
            <Show when={frame()?.kind === 'video'}>
              <div class="cb-controls">
                <label>
                  Frame at
                  <input
                    type="range"
                    min="0"
                    max={frame()!.duration}
                    step="0.1"
                    value={t()}
                    onChange={(e) => void scrub(+e.currentTarget.value)}
                  />
                  {t().toFixed(1)} s
                </label>
                <button class="btn-secondary btn-small" onClick={() => void showBackground()}>
                  Show the empty arena
                </button>
              </div>
            </Show>
          </section>

          <section class="cb-group">
            <h3>2. Arena outline and scale</h3>
            <div class="cb-controls">
              <label>
                Shape
                <select
                  value={arena.shape}
                  onChange={(e) =>
                    setArena('shape', e.currentTarget.value as 'rectangle' | 'circle')
                  }
                >
                  <option value="rectangle">Rectangle</option>
                  <option value="circle">Circle</option>
                </select>
              </label>
              {toolBtn('arena', 'Draw the arena')}
            </div>
            <div class="cb-controls">
              <span>Position file units</span>
              <div class="cb-seg">
                <For
                  each={
                    [
                      ['cm', 'cm'],
                      ['px', 'pixels'],
                    ] as const
                  }
                >
                  {([v, label]) => (
                    <button
                      classList={{ 'cb-seg__on': source.positionUnit === v }}
                      onClick={() => setSource('positionUnit', v)}
                    >
                      {label}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <div class="cb-controls">
              <label>
                Scale from
                <select
                  value={arena.scaleMode}
                  onChange={(e) =>
                    setArena('scaleMode', e.currentTarget.value as 'arena' | 'distance')
                  }
                >
                  <option value="arena">The arena's real size</option>
                  <option value="distance">A known distance</option>
                </select>
              </label>
            </div>
            <Show when={arena.scaleMode === 'arena'}>
              <div class="cb-controls">
                <label>
                  {arena.shape === 'circle' ? 'Diameter' : 'Width'}
                  <input
                    type="number"
                    min="1"
                    value={arena.width}
                    onInput={num((v) => setArena('width', v), 1)}
                  />{' '}
                  cm
                </label>
                <Show when={arena.shape === 'rectangle'}>
                  <label>
                    Height
                    <input
                      type="number"
                      min="1"
                      value={arena.height}
                      onInput={num((v) => setArena('height', v), 1)}
                    />{' '}
                    cm
                  </label>
                </Show>
              </div>
              <Show
                when={
                  arena.box &&
                  arena.shape === 'rectangle' &&
                  Math.abs(arena.box.w / arena.width - arena.box.h / arena.height) /
                    (arena.box.w / arena.width) >
                    0.05
                }
              >
                <div class="cb-note">
                  The drawn shape and the width and height do not have the same proportions. Redraw
                  the arena, or check the sizes.
                </div>
              </Show>
            </Show>
            <Show when={arena.scaleMode === 'distance'}>
              <div class="cb-controls">
                {toolBtn('distance', 'Draw a known distance')}
                <label>
                  It is
                  <input
                    type="number"
                    min="0.1"
                    step="0.5"
                    value={arena.lineCm}
                    onInput={num((v) => setArena('lineCm', v), 0.1)}
                  />{' '}
                  cm
                </label>
              </div>
            </Show>
            <div class="cb-muted">
              Scale:{' '}
              {pxPerCm()
                ? `${pxPerCm()!.toFixed(2)} pixels per cm. Arena ${sizeCm()[0].toFixed(1)}${arena.shape === 'circle' ? '' : ` x ${sizeCm()[1].toFixed(1)}`} cm.`
                : 'draw the arena and set the scale.'}
            </div>
          </section>

          <section class="cb-group">
            <h3>3. Zones and excluded regions</h3>
            <Note>
              Zones are places the analyses compare, such as center, reward or an object. Excluded
              regions are places the animal cannot go, such as walls or an enclosure. They are left
              out of place maps so they do not look unvisited.
            </Note>
            <div class="cb-controls">
              <label>
                Type
                <select
                  value={zoneKind()}
                  onChange={(e) => setZoneKind(e.currentTarget.value as 'zone' | 'exclude')}
                >
                  <option value="zone">Zone</option>
                  <option value="exclude">Excluded region</option>
                </select>
              </label>
              <label>
                Shape
                <select
                  value={zoneShape()}
                  onChange={(e) => {
                    setZoneShape(e.currentTarget.value as ReturnType<typeof zoneShape>);
                    setPoly([]);
                  }}
                >
                  <option value="rect">Rectangle</option>
                  <option value="square">Square</option>
                  <option value="circle">Circle</option>
                  <option value="polygon">Polygon (click corners)</option>
                  <option value="freehand">Free draw</option>
                </select>
              </label>
              <label>
                Name
                <input
                  type="text"
                  placeholder="center"
                  value={zoneName()}
                  onInput={(e) => setZoneName(e.currentTarget.value)}
                />
              </label>
              {toolBtn('zone', '+ Add zone')}
              <Show when={tool() === 'zone' && zoneShape() === 'polygon' && poly().length > 2}>
                <button
                  class="btn-secondary btn-small"
                  onClick={() => {
                    addZone(poly());
                    setTool('none');
                  }}
                >
                  Finish
                </button>
              </Show>
            </div>
            <div class="cb-zonelist">
              <For each={arena.zones}>
                {(z, i) => (
                  <div class="cb-zonelist__row">
                    <i
                      style={{
                        background:
                          z.kind === 'exclude' ? '#d32f2f' : ZONE_COLORS[i() % ZONE_COLORS.length],
                      }}
                    />
                    <b>{z.name}</b>
                    <span class="cb-muted">
                      {z.kind === 'exclude' ? 'excluded region' : 'zone'}, {z.shape}
                    </span>
                    <span class="cb-spacer" />
                    <button
                      class="cb-link"
                      onClick={() => setArena('zones', (zs) => zs.filter((_, k) => k !== i()))}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </For>
            </div>
          </section>

          <section class="cb-group">
            <h3>4. Animal size</h3>
            <Note>
              Use a frame where the animal is walking and stretched out, not rearing or curled up.
              Type it in, or draw it on a frame with the animal in it (this needs the scale).
            </Note>
            <div class="cb-instruction">
              Measure from the <b>tip of the nose</b> to the <b>base of the tail</b>. Do not include
              the tail.
            </div>
            <div class="cb-controls">
              <label>
                Length, nose tip to tail base
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={arena.bodyLength?.toFixed(1) ?? ''}
                  placeholder="8"
                  onInput={(e) => {
                    setArena('bodyLine', undefined);
                    setArena(
                      'bodyLength',
                      e.currentTarget.value ? +e.currentTarget.value : undefined,
                    );
                  }}
                />{' '}
                cm
              </label>
              {toolBtn('animal', 'Measure on the picture')}
            </div>
            <Show when={arena.bodyLine && !pxPerCm()}>
              <div class="cb-note">
                The line is drawn, but the length needs the scale. Draw the arena first (section 2).
              </div>
            </Show>
          </section>
        </div>

        <div class="cb-arena-view">
          <div class="cb-tabs" role="tablist">
            <For
              each={
                [
                  ['top', 'Top view'],
                  ['tracking', 'Tracking example'],
                  ['zones', 'Zone occupancy'],
                ] as const
              }
            >
              {([id, label]) => (
                <button
                  role="tab"
                  aria-selected={viewTab() === id}
                  classList={{ 'cb-tab--on': viewTab() === id }}
                  onClick={() => setViewTab(id)}
                >
                  {label}
                </button>
              )}
            </For>
          </div>
          <Show when={viewTab() === 'tracking'}>
            <Trajectory bare mode="path" />
          </Show>
          <Show when={viewTab() === 'zones'}>
            <Trajectory bare mode="time" />
            <Show
              when={zoneShare().length}
              fallback={
                <div class="cb-note">
                  Draw zones and load position to see how much time the animal spends in each zone.
                </div>
              }
            >
              <table class="cb-stats">
                <thead>
                  <tr>
                    <th>Zone</th>
                    <th>Time inside</th>
                    <th>Share of tracked time</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={zoneShare()}>
                    {(z) => (
                      <tr>
                        <td>
                          <i
                            class="cb-dot"
                            style={{ background: ZONE_COLORS[z.index % ZONE_COLORS.length] }}
                          />{' '}
                          {z.name}
                        </td>
                        <td>{z.seconds.toFixed(0)} s</td>
                        <td>{z.pct.toFixed(1)}%</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          </Show>
          <div style={{ display: viewTab() === 'top' ? 'block' : 'none' }}>
            <Show when={tool() !== 'none'}>
              <div class="cb-note">{hint()}</div>
            </Show>
            <Show when={frame() && !pxPerCm() && tool() === 'none'}>
              <div class="cb-note">
                Next: press Draw the arena (section 2) and drag across the arena. That sets the
                scale, and the bins and the time in each bin appear.
              </div>
            </Show>
            <Show
              when={frame()}
              fallback={
                <div class="cb-empty">
                  Choose a picture or video, or use a blank arena, to start drawing.
                </div>
              }
            >
              <canvas
                ref={canvas}
                class="cb-arena-canvas"
                classList={{ 'cb-arena-canvas--draw': tool() !== 'none' }}
                onMouseDown={(e) => {
                  if (dragTool()) setDrag([pt(e), pt(e)]);
                  else if (freehand()) setPoly([pt(e)]);
                }}
                onMouseMove={(e) => {
                  if (drag()) setDrag([drag()![0], pt(e)]);
                  else if (freehand() && poly().length) {
                    const p = pt(e);
                    const last = poly()[poly().length - 1];
                    if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 3) setPoly((q) => [...q, p]);
                  } else onHover(e);
                }}
                onMouseLeave={() => setHover(undefined)}
                onMouseUp={(e) => {
                  if (freehand() && poly().length > 2) {
                    addZone(poly());
                    setTool('none');
                    return;
                  }
                  const d = drag();
                  setDrag(undefined);
                  if (d && Math.hypot(d[0][0] - pt(e)[0], d[0][1] - pt(e)[1]) > 4)
                    commitDrag(d[0], pt(e));
                }}
                onClick={onClick}
                onDblClick={() => {
                  if (tool() === 'zone' && zoneShape() === 'polygon' && poly().length > 2) {
                    addZone(poly());
                    setTool('none');
                  }
                }}
                aria-label="Picture of the arena"
              />
              <label class="cb-muted">
                <input
                  type="checkbox"
                  checked={showBins()}
                  onChange={(e) => setShowBins(e.currentTarget.checked)}
                />{' '}
                Show place map bins (size is set in Preprocess)
              </label>
              <Show when={showBins() && binData()}>
                <div class="cb-legend">
                  <Show when={binData()!.occ}>
                    <span>Time in a bin</span>
                    <span>0 s</span>
                    <span class="cb-legend__bar" />
                    <span>{binData()!.top.toFixed(1)} s or more</span>
                    <span class="cb-legend__item">
                      <i style={{ background: 'rgba(215,50,50,0.35)' }} />
                      under {arena.minOccupancy} s
                    </span>
                  </Show>
                  <span class="cb-legend__item">
                    <i style={{ background: 'rgba(90,90,90,0.5)' }} />
                    excluded
                  </span>
                </div>
              </Show>
              <div class="cb-muted">
                <Show when={hover()}>
                  <b>
                    Bin at x {(hover()!.i * effectiveBin()).toFixed(1)} to{' '}
                    {((hover()!.i + 1) * effectiveBin()).toFixed(1)} cm, y{' '}
                    {(hover()!.j * effectiveBin()).toFixed(1)} to{' '}
                    {((hover()!.j + 1) * effectiveBin()).toFixed(1)} cm:{' '}
                    {!hover()!.open
                      ? 'excluded'
                      : hover()!.sec === undefined
                        ? 'no position loaded'
                        : `${hover()!.sec!.toFixed(2)} s`}
                    .
                  </b>{' '}
                </Show>
                {frame()!.name}. Blue outline: arena. Dashed red: excluded region.
              </div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
