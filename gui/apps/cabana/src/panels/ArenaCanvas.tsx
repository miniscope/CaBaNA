// The arena editor's canvas: the picture, the boundary, regions, the trajectory and handles, and
// the mouse gestures that draw, move, resize and pan. Changes go through ed.edit so Undo sees them.

import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from 'solid-js';
import {
  type Pt,
  arena,
  binGrid,
  effectiveBin,
  frame,
  frameVersion,
  freeName,
  inZone,
  nameTaken,
  occupancy,
  positionsCm,
  pxPerCm,
  setArena,
  type Zone,
} from '../lib/arena.ts';
import { moveRegion, regionBox, regionHandles, resizeRegion } from '../lib/arena-geometry.ts';
import type { ArenaEditor } from '../lib/arena-editor.ts';
import {
  ZONE_COLORS,
  adjustBox,
  arenaOutline,
  boxCorners,
  shapePath,
  tracePath,
} from '../lib/draw.ts';
import { previewRegions, regionNotice } from '../lib/region-notice.ts';

type Box = NonNullable<typeof arena.box>;
const BOUNDARY = '#1d9e75';
const EXCLUDED = '#c62828';
const SCALE_LINE = '#ffd54f';

type Gesture =
  | { kind: 'pan'; from: Pt; pan0: Pt }
  | {
      kind: 'move' | 'resize';
      target: 'boundary' | number;
      from: Pt;
      handle: number;
      box0?: Box;
      pts0?: Pt[];
    };
/** A shape shown at its dragged position until the mouse is let go. */
type Preview = { box?: Box; zone?: { index: number; pts: Pt[] } };

export function ArenaCanvas(props: {
  ed: ArenaEditor;
  onCanvas: (c: HTMLCanvasElement) => void;
  /** Bumped when the canvas is laid out again, so overlays anchored to shapes can follow. */
  onLayout: () => void;
}): JSX.Element {
  // The editor object is created once and does not change for this window.
  // eslint-disable-next-line solid/reactivity
  const ed = props.ed;
  let canvas!: HTMLCanvasElement;
  let holder!: HTMLDivElement;
  const [layout, setLayout] = createSignal(0);
  const [drag, setDrag] = createSignal<[Pt, Pt]>();
  const [poly, setPoly] = createSignal<Pt[]>([]);
  const [clicks, setClicks] = createSignal<Pt[]>([]);
  const [gesture, setGesture] = createSignal<Gesture>();
  const [preview, setPreview] = createSignal<Preview>();
  const [cursor, setCursor] = createSignal('');
  const [hover, setHover] = createSignal<{ i: number; j: number; sec?: number; open: boolean }>();
  let moved = false;

  /** Gives the canvas the largest size that fits the holder, keeping the picture's proportions. */
  const fitCanvas = () => {
    if (!canvas.width || !holder) return;
    const k = Math.min(holder.clientWidth / canvas.width, holder.clientHeight / canvas.height);
    canvas.style.width = `${Math.floor(canvas.width * k)}px`;
    canvas.style.height = `${Math.floor(canvas.height * k)}px`;
  };
  onMount(() => {
    props.onCanvas(canvas);
    const ro = new ResizeObserver(() => {
      fitCanvas();
      setLayout((n) => n + 1);
      props.onLayout();
    });
    ro.observe(holder);
    onCleanup(() => ro.disconnect());
  });

  const pt = (e: MouseEvent): Pt => {
    const r = canvas.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width) * canvas.width,
      ((e.clientY - r.top) / r.height) * canvas.height,
    ];
  };
  /** Picture pixels per screen pixel. */
  const perScreen = () => canvas.width / (canvas.getBoundingClientRect().width || canvas.width);

  const resetDrawing = () => {
    setDrag(undefined);
    setPoly([]);
    setClicks([]);
    setGesture(undefined);
    setPreview(undefined);
  };
  // A tool belongs to the moment it was chosen: changing it drops a half-drawn shape.
  createEffect(() => {
    ed.tool();
    ed.zoneShape();
    resetDrawing();
  });

  // Escape drops a drawing in progress or a tool before it closes the window; Enter closes a polygon.
  const key = (e: KeyboardEvent) => {
    const typing = e.target instanceof Element && e.target.closest('input, textarea, select');
    if (e.key === 'Escape' && (ed.tool() !== 'select' || gesture() || ed.popup())) {
      e.preventDefault();
      e.stopPropagation();
      if (ed.popup()) ed.setPopup(undefined);
      ed.setTool('select');
      resetDrawing();
    } else if (e.key === 'Enter' && !typing && ed.tool() === 'zone' && poly().length > 2) {
      addZone(poly());
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) {
      const s = ed.selected();
      if (typeof s === 'number') {
        e.preventDefault();
        ed.edit(() => setArena('zones', (zs) => zs.filter((_, k) => k !== s)));
        ed.setSelected(undefined);
      }
    }
  };
  onMount(() => {
    document.addEventListener('keydown', key, true);
    onCleanup(() => document.removeEventListener('keydown', key, true));
  });

  const dragTool = () =>
    ed.tool() === 'boundary' ||
    ed.tool() === 'distance' ||
    (ed.tool() === 'zone' && ['rect', 'square', 'circle'].includes(ed.zoneShape()));
  const freehand = () => ed.tool() === 'zone' && ed.zoneShape() === 'freehand';

  const squareCorner = (a: Pt, b: Pt): Pt => {
    const side = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    return [a[0] + Math.sign(b[0] - a[0] || 1) * side, a[1] + Math.sign(b[1] - a[1] || 1) * side];
  };

  function addZone(pts: Pt[]) {
    const kind = ed.zoneKind();
    const drawn = ed.zoneShape();
    const shape = drawn === 'square' ? 'rect' : drawn === 'freehand' ? 'polygon' : drawn;
    const name = freeName(kind, shape);
    if (nameTaken(name, kind, shape)) return;
    ed.edit(() => setArena('zones', (zs) => [...zs, { name, kind, shape, pts }]));
    ed.setSelected(arena.zones.length - 1);
    ed.setTool('select');
  }

  function commitDrag(a: Pt, b: Pt) {
    const tool = ed.tool();
    if (tool === 'boundary') {
      const side = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      const x = Math.min(a[0], b[0]);
      const y = Math.min(a[1], b[1]);
      const box =
        arena.shape === 'circle'
          ? { x, y, w: side, h: side }
          : { x, y, w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
      ed.edit(() => setArena('box', box));
      ed.setSelected('boundary');
      ed.setTool('select');
    } else if (tool === 'distance') {
      ed.setScaleLine([a, b]);
    } else if (tool === 'zone') {
      addZone([a, ed.zoneShape() === 'square' ? squareCorner(a, b) : b]);
    }
  }

  // ---- hit tests in select mode
  const nearBoundary = (p: Pt): boolean => {
    const b = arena.box;
    if (!b) return false;
    const r = 6 * perScreen();
    if (arena.shape === 'circle') {
      const d = Math.hypot(p[0] - (b.x + b.w / 2), p[1] - (b.y + b.h / 2));
      return Math.abs(d - b.w / 2) <= r;
    }
    const inside =
      p[0] >= b.x - r && p[0] <= b.x + b.w + r && p[1] >= b.y - r && p[1] <= b.y + b.h + r;
    const deep = p[0] > b.x + r && p[0] < b.x + b.w - r && p[1] > b.y + r && p[1] < b.y + b.h - r;
    return inside && !deep;
  };
  const handlesOf = (target: 'boundary' | number): Pt[] => {
    if (target === 'boundary') return arena.box ? boxCorners(arena.box) : [];
    const z = arena.zones[target];
    return z ? regionHandles(z) : [];
  };
  const hitHandle = (p: Pt): { target: 'boundary' | number; handle: number } | undefined => {
    const target = ed.selected();
    if (target === undefined) return undefined;
    const r = 9 * perScreen();
    const handle = handlesOf(target).findIndex((h) => Math.hypot(h[0] - p[0], h[1] - p[1]) <= r);
    return handle >= 0 ? { target, handle } : undefined;
  };
  const zoneAt = (p: Pt): number => {
    for (let i = arena.zones.length - 1; i >= 0; i--) if (inZone(p, arena.zones[i])) return i;
    return -1;
  };
  type Hit =
    | { kind: 'handle'; target: 'boundary' | number; handle: number }
    | { kind: 'shape'; target: 'boundary' | number }
    | undefined;
  const hitAt = (p: Pt): Hit => {
    const h = hitHandle(p);
    if (h) return { kind: 'handle', ...h };
    const z = zoneAt(p);
    if (z >= 0) return { kind: 'shape', target: z };
    if (nearBoundary(p)) return { kind: 'shape', target: 'boundary' };
    return undefined;
  };

  const startGesture = (e: MouseEvent) => {
    const p = pt(e);
    const hit = hitAt(p);
    moved = false;
    if (!hit) return setGesture({ kind: 'pan', from: [e.clientX, e.clientY], pan0: ed.pan() });
    ed.setSelected(hit.target);
    const box0 = hit.target === 'boundary' ? { ...arena.box! } : undefined;
    const pts0 =
      typeof hit.target === 'number'
        ? arena.zones[hit.target].pts.map((q) => [...q] as Pt)
        : undefined;
    setGesture({
      kind: hit.kind === 'handle' ? 'resize' : 'move',
      target: hit.target,
      from: p,
      handle: hit.kind === 'handle' ? hit.handle : -1,
      box0,
      pts0,
    });
  };

  const dragged = (g: Extract<Gesture, { kind: 'move' | 'resize' }>, p: Pt): Preview => {
    if (g.target === 'boundary') {
      const b = g.kind === 'move' ? 'move' : g.handle;
      return { box: adjustBox(g.box0!, b, g.from, p, arena.shape === 'circle') };
    }
    const z = arena.zones[g.target];
    const pts =
      g.kind === 'move'
        ? moveRegion({ shape: z.shape, pts: g.pts0! }, p[0] - g.from[0], p[1] - g.from[1])
        : resizeRegion({ shape: z.shape, pts: g.pts0! }, g.handle, p);
    return { zone: { index: g.target, pts } };
  };

  const finishGesture = () => {
    const g = gesture();
    setGesture(undefined);
    const pv = preview();
    setPreview(undefined);
    if (!g) return;
    if (g.kind === 'pan') {
      if (!moved) ed.setSelected(undefined);
      return;
    }
    // One change of the outline or region, so Undo and the regions question see a single step.
    if (pv?.box) ed.edit(() => setArena('box', pv.box));
    else if (pv?.zone) ed.edit(() => setArena('zones', pv.zone!.index, 'pts', pv.zone!.pts));
  };

  const onMove = (e: MouseEvent) => {
    const g = gesture();
    if (g?.kind === 'pan') {
      moved = true;
      return ed.setPan([g.pan0[0] + e.clientX - g.from[0], g.pan0[1] + e.clientY - g.from[1]]);
    }
    if (g) {
      moved = true;
      return setPreview(dragged(g, pt(e)));
    }
    if (drag()) return setDrag([drag()![0], pt(e)]);
    if (freehand() && poly().length) {
      const p = pt(e);
      const last = poly()[poly().length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 3) setPoly((q) => [...q, p]);
      return;
    }
    if (ed.tool() === 'select') {
      const h = hitAt(pt(e));
      setCursor(!h ? 'grab' : h.kind === 'handle' ? 'crosshair' : 'move');
    } else setCursor('');
    onHover(e);
  };

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    if (ed.tool() === 'select') return startGesture(e);
    if (dragTool()) setDrag([pt(e), pt(e)]);
    else if (freehand()) setPoly([pt(e)]);
  };

  const onUp = (e: MouseEvent) => {
    if (gesture()) return finishGesture();
    if (freehand() && poly().length > 2) return addZone(poly());
    const d = drag();
    setDrag(undefined);
    if (d && Math.hypot(d[0][0] - pt(e)[0], d[0][1] - pt(e)[1]) > 4) commitDrag(d[0], pt(e));
  };

  const onClick = (e: MouseEvent) => {
    const p = pt(e);
    if (ed.tool() === 'zone' && ed.zoneShape() === 'polygon') setPoly((q) => [...q, p]);
    if (ed.tool() === 'animal') {
      const c = [...clicks(), p];
      if (c.length < 2) return setClicks(c);
      setClicks([]);
      ed.edit(() => setArena('bodyLine', [c[0], c[1]]));
      ed.setTool('select');
    }
  };

  // ---- bins: the seconds spent in each bin of the place maps
  const binData = createMemo(() => {
    const g = pxPerCm() && arena.box ? binGrid(effectiveBin()) : undefined;
    if (!g) return undefined;
    const occ = positionsCm().x.length ? occupancy(g) : undefined;
    const times = occ ? [...occ].filter((_, i) => g.open[i]).sort((p, q) => p - q) : [];
    return { grid: g, occ, top: times[Math.floor(times.length * 0.95)] || 1 };
  });
  function onHover(e: MouseEvent) {
    const d = ed.showBins() ? binData() : undefined;
    const b = arena.box;
    const s = pxPerCm();
    if (!d || !b || !s) return setHover(undefined);
    const p = pt(e);
    const [i, j] = [
      Math.floor((p[0] - b.x) / s / d.grid.bin),
      Math.floor((b.y + b.h - p[1]) / s / d.grid.bin),
    ];
    if (i < 0 || j < 0 || i >= d.grid.nx || j >= d.grid.ny) return setHover(undefined);
    setHover({ i, j, sec: d.occ?.[j * d.grid.nx + i], open: d.grid.open[j * d.grid.nx + i] });
  }

  /** The trajectory in picture pixels, for drawing. */
  const trajectory = createMemo<Pt[]>(() => {
    const { x, y } = positionsCm();
    const s = pxPerCm();
    const b = arena.box;
    if (!x.length || !s || !b) return [];
    return x.map((v, i) => [b.x + v * s, b.y + b.h - y[i] * s] as Pt);
  });

  // ---- render
  createEffect(() => {
    const f = frame();
    frameVersion();
    layout();
    const ctx = canvas.getContext('2d');
    if (!f || !ctx) return;
    canvas.width = f.canvas.width;
    canvas.height = f.canvas.height;
    fitCanvas();
    // Lines, handles and labels keep their size on screen however small the picture is shown or
    // how far it is zoomed.
    ed.zoom();
    const s = perScreen() || 1;
    const lw = 2.5 * s;
    const pv = preview();
    const box = pv?.box ?? arena.box;
    ctx.drawImage(f.canvas, 0, 0);

    drawBins(ctx, box, s);

    if (ed.showTrajectory() && trajectory().length) {
      tracePath(ctx, trajectory(), false);
      ctx.strokeStyle = 'rgba(90,92,100,0.55)';
      ctx.lineWidth = Math.max(0.8, 0.8 * s);
      ctx.stroke();
    }

    arena.zones.forEach((z, i) => {
      const live = pv?.zone?.index === i ? { ...z, pts: pv.zone.pts } : z;
      drawRegion(ctx, live, i, ed.selected() === i, lw, s);
    });

    if (box) {
      arenaOutline(ctx, box, arena.shape);
      ctx.strokeStyle = BOUNDARY;
      ctx.lineWidth = ed.selected() === 'boundary' ? lw * 1.4 : lw;
      ctx.stroke();
      if (ed.selected() === 'boundary') {
        label(ctx, 'Arena boundary', box.x + box.w / 2, box.y - 16 * s, BOUNDARY, s, true);
        handles(ctx, boxCorners(box), BOUNDARY, s);
      }
    }
    const sel = ed.selected();
    if (typeof sel === 'number' && arena.zones[sel]) {
      const z =
        pv?.zone?.index === sel ? { ...arena.zones[sel], pts: pv.zone.pts } : arena.zones[sel];
      handles(ctx, regionHandles(z), zoneColor(z, sel), s);
    }

    // After a change with regions drawn: the old outline dashed, and the regions as "Keep
    // position in cm" would place them while that choice is hovered.
    const before = regionNotice()?.before.box;
    if (before) {
      arenaOutline(ctx, before, regionNotice()!.before.shape);
      ctx.strokeStyle = 'rgba(90,90,90,0.8)';
      ctx.lineWidth = lw;
      ctx.setLineDash([10 * s, 6 * s]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const ghost = previewRegions();
    if (ghost) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ghost.forEach((z, i) => drawRegion(ctx, z, i, false, lw, s));
      ctx.restore();
    }

    drawLine(
      ctx,
      ed.popup() === 'scale'
        ? ed.scaleLine()
        : arena.scaleMode === 'distance'
          ? arena.line
          : undefined,
      SCALE_LINE,
      lw,
      s,
      ed.popup() === 'scale' ? undefined : `${arena.lineCm} cm`,
    );
    drawLine(
      ctx,
      arena.bodyLine,
      '#b07cd6',
      lw,
      s,
      arena.bodyLength ? `${arena.bodyLength.toFixed(1)} cm` : undefined,
    );

    drawInProgress(ctx, lw, s);
  });

  const zoneColor = (z: Pick<Zone, 'kind'>, i: number) =>
    z.kind === 'exclude' ? EXCLUDED : ZONE_COLORS[i % ZONE_COLORS.length];

  function drawRegion(
    ctx: CanvasRenderingContext2D,
    z: Zone,
    i: number,
    selected: boolean,
    lw: number,
    s: number,
  ) {
    const col = zoneColor(z, i);
    shapePath(ctx, z);
    ctx.fillStyle = col + (z.kind === 'exclude' ? '2e' : '47');
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = selected ? lw * 1.4 : lw * 0.8;
    ctx.setLineDash(z.kind === 'exclude' ? [8 * s, 5 * s] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    if (z.kind === 'zone') {
      const b = regionBox(z);
      label(ctx, z.name, b.x + b.w / 2, b.y + b.h / 2, col, s, false);
    }
  }

  function label(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    col: string,
    s: number,
    filled: boolean,
  ) {
    ctx.font = `600 ${13 * s}px sans-serif`;
    const w = ctx.measureText(text).width + 22 * s;
    const h = 22 * s;
    ctx.fillStyle = filled ? col : '#fff';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = filled ? '#fff' : col;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + s);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  function handles(ctx: CanvasRenderingContext2D, pts: Pt[], col: string, s: number) {
    const r = 6 * s;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = col;
    ctx.lineWidth = 2 * s;
    for (const [x, y] of pts) {
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      ctx.strokeRect(x - r, y - r, 2 * r, 2 * r);
    }
  }

  function drawLine(
    ctx: CanvasRenderingContext2D,
    l: [Pt, Pt] | undefined,
    col: string,
    lw: number,
    s: number,
    text?: string,
  ) {
    if (!l) return;
    tracePath(ctx, l, false);
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.stroke();
    ctx.fillStyle = col;
    for (const p of l) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], 4 * s, 0, 2 * Math.PI);
      ctx.fill();
    }
    if (text) {
      ctx.font = `${13 * s}px sans-serif`;
      ctx.fillText(text, (l[0][0] + l[1][0]) / 2 + 6 * s, (l[0][1] + l[1][1]) / 2 - 6 * s);
    }
  }

  function drawInProgress(ctx: CanvasRenderingContext2D, lw: number, s: number) {
    ctx.strokeStyle = SCALE_LINE;
    ctx.lineWidth = lw;
    ctx.setLineDash([6 * s, 4 * s]);
    const d = drag();
    if (d) {
      if (ed.tool() === 'distance') {
        ctx.setLineDash([]);
        tracePath(ctx, d, false);
      } else {
        const circle =
          ed.tool() === 'boundary' ? arena.shape === 'circle' : ed.zoneShape() === 'circle';
        const square = ed.tool() === 'zone' && ed.zoneShape() === 'square';
        shapePath(ctx, {
          shape: circle ? 'circle' : 'rect',
          pts:
            ed.tool() === 'boundary' && circle
              ? [[(d[0][0] + d[1][0]) / 2, (d[0][1] + d[1][1]) / 2], d[1]]
              : square
                ? [d[0], squareCorner(d[0], d[1])]
                : d,
        });
      }
      ctx.stroke();
    }
    if (poly().length) {
      tracePath(ctx, poly(), false);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = SCALE_LINE;
    clicks().forEach((p) => ctx.fillRect(p[0] - 3 * s, p[1] - 3 * s, 6 * s, 6 * s));
  }

  function drawBins(ctx: CanvasRenderingContext2D, b: Box | undefined, s: number) {
    const bd = ed.showBins() ? binData() : undefined;
    if (!bd || !b) return;
    const { grid, occ, top } = bd;
    const cell = grid.bin * pxPerCm()!;
    ctx.save();
    arenaOutline(ctx, b, arena.shape);
    ctx.clip();
    for (let j = 0; j < grid.ny; j++)
      for (let i = 0; i < grid.nx; i++) {
        const k = j * grid.nx + i;
        const x = b.x + i * cell;
        const y = b.y + b.h - (j + 1) * cell;
        if (!grid.open[k]) ctx.fillStyle = 'rgba(90,90,90,0.5)';
        else if (occ)
          ctx.fillStyle =
            occ[k] < arena.minOccupancy
              ? 'rgba(215,50,50,0.35)'
              : `rgba(33,113,181,${0.08 + 0.4 * Math.min(1, occ[k] / top)})`;
        else continue;
        ctx.fillRect(x, y, cell, cell);
      }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = s;
    ctx.beginPath();
    for (let i = 0; i <= grid.nx; i++) {
      ctx.moveTo(b.x + i * cell, b.y);
      ctx.lineTo(b.x + i * cell, b.y + b.h);
    }
    for (let j = 0; j <= grid.ny; j++) {
      ctx.moveTo(b.x, b.y + b.h - j * cell);
      ctx.lineTo(b.x + b.w, b.y + b.h - j * cell);
    }
    ctx.stroke();
    ctx.restore();
  }

  const crosshair = () => ed.tool() !== 'select';
  return (
    <>
      <div
        class="cb-ae-holder"
        classList={{ 'cb-ae-holder--wide': !ed.showOccupancy() }}
        ref={holder}
      >
        <Show when={frame()}>
          <canvas
            ref={canvas}
            class="cb-ae-canvas"
            style={{
              transform: `translate(${ed.pan()[0]}px, ${ed.pan()[1]}px) scale(${ed.zoom()})`,
              cursor: crosshair() ? 'crosshair' : cursor() || undefined,
            }}
            aria-label="Picture of the arena"
            onWheel={(e) => {
              if (!e.ctrlKey && !e.metaKey) return;
              e.preventDefault();
              ed.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
            }}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={() => {
              setHover(undefined);
              if (gesture()) finishGesture();
              setDrag(undefined);
            }}
            onClick={onClick}
            onDblClick={() => {
              if (ed.tool() === 'zone' && ed.zoneShape() === 'polygon' && poly().length > 2)
                addZone(poly());
            }}
          />
        </Show>
      </div>
      <Show when={ed.showBins() && binData()}>
        <div class="cb-ae-bins">
          <Show when={binData()!.occ}>
            <span>Time in a bin</span>
            <span>0 s</span>
            <span class="cb-legend__bar" />
            <span>{binData()!.top.toFixed(1)} s or more</span>
            <span class="cb-legend__item">
              <i style={{ background: 'rgba(215,50,50,0.35)' }} /> under {arena.minOccupancy} s
            </span>
          </Show>
          <span class="cb-legend__item">
            <i style={{ background: 'rgba(90,90,90,0.5)' }} /> excluded
          </span>
          <Show when={hover()}>
            {(h) => (
              <b>
                x {(h().i * effectiveBin()).toFixed(1)} to{' '}
                {((h().i + 1) * effectiveBin()).toFixed(1)} cm, y{' '}
                {(h().j * effectiveBin()).toFixed(1)} to {((h().j + 1) * effectiveBin()).toFixed(1)}{' '}
                cm:{' '}
                {!h().open
                  ? 'excluded'
                  : h().sec === undefined
                    ? 'no position loaded'
                    : `${h().sec!.toFixed(2)} s`}
              </b>
            )}
          </Show>
        </div>
      </Show>
    </>
  );
}
