// The arena editor window: Actions (Undo, Reset view, Save arena, Cancel), a toolbar, and a dark
// canvas with the layer list, the selected shape's pop-over, zone occupancy and the inside-the-arena
// check floating over it. Opened from Experimental setup and from Data visualization.

import { createEffect, createSignal, on, Show, type JSX } from 'solid-js';
import { ActionsMenu } from '../components/ActionsMenu.tsx';
import { Modal } from '../components/Modal.tsx';
import type { MenuItem } from '../lib/actions-menu.ts';
import { arena, frame, pxPerCm, setArena } from '../lib/arena.ts';
import { createArenaEditor, MAX_ZOOM, type Tool, type ZoneDrawShape } from '../lib/arena-editor.ts';
import { entryOf } from '../lib/spatial-checks.ts';
import { loadBackground, useBlankCanvas } from '../lib/spatial-background.ts';
import { spatialSnapshot, videoChoice } from '../lib/spatial-state.ts';
import { exampleMedia, sessionName } from '../lib/store.ts';
import '../styles/arena-editor.css';
import { AnimalPopup, FramePopup, ScalePopup } from './ArenaPopups.tsx';
import { ArenaCanvas } from './ArenaCanvas.tsx';
import {
  InsideCheck,
  LayerList,
  Notes,
  OccupancyChart,
  popoverPlace,
  ShapePopover,
} from './ArenaPanels.tsx';
import { SpatialLanding } from './SpatialLanding.tsx';
import { RegionNoticeBox } from './SpatialSetup.tsx';

const ZONE_SHAPES: [ZoneDrawShape, string][] = [
  ['rect', 'Rectangle'],
  ['square', 'Square'],
  ['circle', 'Circle'],
  ['polygon', 'Polygon (click corners)'],
  ['freehand', 'Free draw'],
];

export function ArenaEditor(props: { onClose: () => void }): JSX.Element {
  const ed = createArenaEditor();
  let stage!: HTMLDivElement;
  let fileInput!: HTMLInputElement;
  const [canvasEl, setCanvasEl] = createSignal<HTMLCanvasElement>();
  const [layout, setLayout] = createSignal(0);
  const [anchor, setAnchor] = createSignal<{ left: number; top: number }>();
  const landing = () => entryOf(spatialSnapshot()) === 'landing';

  // The measured animal length follows the scale.
  createEffect(() => {
    const s = pxPerCm();
    const l = arena.bodyLine;
    if (s && l) setArena('bodyLength', Math.hypot(l[0][0] - l[1][0], l[0][1] - l[1][1]) / s);
  });
  // A video needs a frame chosen as the background; ask once it is loaded.
  createEffect(
    on(
      () => [frame(), videoChoice()],
      () => {
        if (frame()?.kind === 'video' && !videoChoice()) ed.setPopup('frame');
      },
    ),
  );
  // Where the selected shape is on screen; read after the canvas has been laid out again.
  createEffect(() => {
    layout();
    ed.zoom();
    ed.pan();
    ed.selected();
    JSON.stringify([arena.zones, arena.box]);
    queueMicrotask(() => setAnchor(popoverPlace(ed, canvasEl(), stage)));
  });

  const finish = (commit: boolean) => {
    if (commit) ed.save();
    else ed.discard();
    props.onClose();
  };
  const pick = (t: Tool) => {
    ed.setPopup(undefined);
    ed.setTool(ed.tool() === t && t !== 'select' ? 'select' : t);
  };

  const actions = (): MenuItem[] => [
    {
      kind: 'action',
      label: 'Undo',
      disabled: ed.canUndo() ? undefined : 'Nothing to undo',
      onSelect: () => ed.undo(),
    },
    { kind: 'action', label: 'Reset view', sub: 'zoom and pan', onSelect: () => ed.resetView() },
    { kind: 'separator' },
    { kind: 'action', label: 'Save arena', onSelect: () => finish(true) },
    { kind: 'action', label: 'Cancel', sub: 'drops the edits', onSelect: () => finish(false) },
  ];

  const viewOptions = (): MenuItem[] => {
    const f = frame();
    const items: MenuItem[] = [
      {
        kind: 'many',
        label: 'Show trajectory',
        checked: ed.showTrajectory(),
        onToggle: (v) => ed.setShowTrajectory(v),
      },
      {
        kind: 'many',
        label: 'Show layer list',
        checked: ed.showLayers(),
        onToggle: (v) => ed.setShowLayers(v),
      },
      {
        kind: 'many',
        label: 'Show place map bins',
        checked: ed.showBins(),
        onToggle: (v) => ed.setShowBins(v),
      },
      { kind: 'separator' },
      { kind: 'header', label: 'Background' },
    ];
    if (f?.kind === 'blank')
      items.push({ kind: 'one', label: 'Blank arena', checked: true, onSelect: () => undefined });
    else
      items.push({
        kind: 'action',
        label: 'Blank arena',
        disabled: arena.box
          ? 'The outline is drawn on the picture; load a new picture instead'
          : undefined,
        onSelect: useBlankCanvas,
      });
    if (f?.kind === 'video')
      items.push({
        kind: 'action',
        label: 'Video frame…',
        sub: f.name,
        onSelect: () => ed.setPopup('frame'),
      });
    else if (f?.kind === 'image')
      items.push({
        kind: 'one',
        label: `Image: ${f.name}`,
        checked: true,
        onSelect: () => undefined,
      });
    items.push({
      kind: 'action',
      label: 'Load image or video…',
      onSelect: () => fileInput.click(),
    });
    const ex = exampleMedia();
    if (ex?.frame && f?.name !== ex.frame.name)
      items.push({
        kind: 'action',
        label: 'Example picture',
        onSelect: () => void loadBackground(ex.frame),
      });
    if (ex?.video && f?.name !== ex.video.name)
      items.push({
        kind: 'action',
        label: 'Example video',
        onSelect: () => void loadBackground(ex.video),
      });
    return items;
  };

  const hint = () => {
    if (ed.popup() === 'scale' && ed.tool() === 'distance')
      return 'Click and drag across a distance you know, such as a ruler or a wall.';
    return (
      {
        select:
          'Drag a shape to move it · drag a handle to resize · drag the background to pan · Esc cancels',
        boundary:
          arena.shape === 'circle'
            ? 'Drag from one side of the arena to the other. Esc cancels'
            : 'Drag from one corner of the arena to the opposite corner. Esc cancels',
        zone:
          ed.zoneShape() === 'polygon'
            ? 'Click each corner. Double-click or press Enter to close the shape. Esc cancels'
            : ed.zoneShape() === 'freehand'
              ? 'Press and hold, then draw the outline. Let go to close the shape. Esc cancels'
              : ed.zoneShape() === 'circle'
                ? 'Drag from the center to the edge. Esc cancels'
                : 'Drag from one corner to the opposite corner. Esc cancels',
        distance: 'Click and drag across a distance you know. Esc cancels',
        animal: 'Click the tip of the nose, then the base of the tail. Esc cancels',
      } satisfies Record<Tool, string>
    )[ed.tool()];
  };

  const toolbar = (): JSX.Element => (
    <div class="cb-ae-bar">
      <div class="cb-seg" role="group" aria-label="Tool">
        <button classList={{ 'cb-seg__on': ed.tool() === 'select' }} onClick={() => pick('select')}>
          Select
        </button>
        <button
          classList={{ 'cb-seg__on': ed.tool() === 'boundary' }}
          onClick={() => pick('boundary')}
        >
          Draw boundary
        </button>
        <button classList={{ 'cb-seg__on': ed.tool() === 'zone' }} onClick={() => pick('zone')}>
          Add zone
        </button>
      </div>
      <Show when={ed.tool() === 'boundary'}>
        <label class="cb-ae-opt">
          Shape
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
      </Show>
      <Show when={ed.tool() === 'zone'}>
        <label class="cb-ae-opt">
          Type
          <select
            value={ed.zoneKind()}
            onChange={(e) => ed.setZoneKind(e.currentTarget.value as 'zone' | 'exclude')}
          >
            <option value="zone">Zone</option>
            <option value="exclude">Excluded region</option>
          </select>
        </label>
        <label class="cb-ae-opt">
          Shape
          <select
            value={ed.zoneShape()}
            onChange={(e) => ed.setZoneShape(e.currentTarget.value as ZoneDrawShape)}
          >
            {ZONE_SHAPES.map(([v, label]) => (
              <option value={v}>{label}</option>
            ))}
          </select>
        </label>
      </Show>
      <button
        class="btn-small"
        classList={{
          'btn-primary': ed.popup() === 'scale',
          'btn-secondary': ed.popup() !== 'scale',
        }}
        aria-expanded={ed.popup() === 'scale'}
        onClick={() => {
          ed.setTool('select');
          ed.setPopup(ed.popup() === 'scale' ? undefined : 'scale');
        }}
      >
        Set scale…
      </button>
      <span class="cb-ae-scale" title="Picture pixels per cm">
        {pxPerCm() ? `${pxPerCm()!.toFixed(2)} px/cm` : 'no scale yet'}
      </span>
      <button
        class="btn-secondary btn-small"
        aria-expanded={ed.popup() === 'animal'}
        onClick={() => {
          ed.setTool('select');
          ed.setPopup(ed.popup() === 'animal' ? undefined : 'animal');
        }}
      >
        Animal size…
      </button>
      <ActionsMenu label="View options" items={viewOptions} />
      <label class="cb-ae-occ-toggle">
        <input
          type="checkbox"
          checked={ed.showOccupancy()}
          onChange={(e) => ed.setShowOccupancy(e.currentTarget.checked)}
        />
        Show zone occupancy
      </label>
    </div>
  );

  return (
    <Modal
      label="Arena editor"
      title="Arena editor"
      head={
        <Show when={sessionName()}>
          <span class="cb-ae-session">{sessionName()}</span>
        </Show>
      }
      actions={<ActionsMenu items={actions} />}
      bar={landing() ? undefined : toolbar()}
      closeLabel="Close. Edits that are not saved are discarded"
      confirmClose={() =>
        ed.dirty()
          ? 'The arena has edits that are not saved. Save arena keeps them; closing discards them.'
          : undefined
      }
      onClose={() => finish(false)}
    >
      <Show
        when={!landing()}
        fallback={
          <div class="cb-ae-landing">
            <SpatialLanding />
          </div>
        }
      >
        <div class="cb-ae" ref={stage}>
          <ArenaCanvas ed={ed} onCanvas={setCanvasEl} onLayout={() => setLayout((n) => n + 1)} />
          <Show when={ed.showLayers()}>
            <LayerList ed={ed} />
          </Show>
          <Show when={!ed.popup()}>
            <div class="cb-ae-hint" role="note">
              {hint()}
            </div>
          </Show>
          <div class="cb-ae-float">
            <RegionNoticeBox />
          </div>
          <ShapePopover ed={ed} place={anchor} />
          <Show when={ed.showOccupancy()}>
            <OccupancyChart />
          </Show>
          <div class="cb-ae-bottom">
            <Notes />
            <InsideCheck />
          </div>
          <div class="cb-ae-zoom" role="group" aria-label="Zoom">
            <button
              class="btn-secondary btn-small"
              disabled={ed.zoom() >= MAX_ZOOM}
              onClick={() => ed.zoomBy(1.5)}
            >
              Zoom in
            </button>
            <button
              class="btn-secondary btn-small"
              disabled={ed.zoom() <= 1}
              onClick={() => ed.zoomBy(1 / 1.5)}
            >
              Zoom out
            </button>
            <button
              class="btn-secondary btn-small"
              disabled={ed.zoom() === 1}
              onClick={() => ed.resetView()}
            >
              Fit
            </button>
          </div>
          <Show when={ed.popup() === 'scale'}>
            <ScalePopup ed={ed} />
          </Show>
          <Show when={ed.popup() === 'animal'}>
            <AnimalPopup ed={ed} />
          </Show>
          <Show when={ed.popup() === 'frame'}>
            <FramePopup ed={ed} />
          </Show>
        </div>
      </Show>
      <input
        ref={fileInput}
        type="file"
        hidden
        accept="image/*,video/*"
        onChange={(e) => void loadBackground(e.currentTarget.files?.[0])}
      />
    </Modal>
  );
}
