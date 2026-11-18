// State of one arena editor session: the tool, selection, view and the draft. Edits are applied to
// the arena store as they are made, so occupancy, scale and the checks stay live; the draft keeps
// the state the editor opened with and the states before each edit, so Undo steps back and
// Cancel (or closing and discarding) puts everything back.

import { createSignal } from 'solid-js';
import { reconcile, unwrap } from 'solid-js/store';
import {
  arena,
  frame,
  pendingZones,
  setArena,
  setFrame,
  setPendingZones,
  type Pt,
} from './arena.ts';
import { copyState, isDirty, markSaved, newDraft, recordEdit, undoEdit } from './arena-draft.ts';
import { withoutNotice } from './region-notice.ts';
import { setSizeEntered, setVideoChoice, sizeEntered, videoChoice } from './spatial-state.ts';

export type Tool = 'select' | 'boundary' | 'zone' | 'distance' | 'animal';
/** The boundary, a region by its index in arena.zones, or nothing. */
export type Selected = 'boundary' | number | undefined;
export type ZoneDrawShape = 'rect' | 'square' | 'circle' | 'polygon' | 'freehand';

export const MAX_ZOOM = 8;

const takeState = () =>
  copyState({ arena: unwrap(arena), sizeEntered: sizeEntered(), pending: pendingZones() });
type State = ReturnType<typeof takeState>;

export function createArenaEditor() {
  const [tool, setTool] = createSignal<Tool>('select');
  const [zoneShape, setZoneShape] = createSignal<ZoneDrawShape>('rect');
  const [zoneKind, setZoneKind] = createSignal<'zone' | 'exclude'>('zone');
  const [selected, setSelected] = createSignal<Selected>();
  const [zoom, setZoom] = createSignal(1);
  const [pan, setPan] = createSignal<Pt>([0, 0]);
  const [showOccupancy, setShowOccupancy] = createSignal(true);
  const [showTrajectory, setShowTrajectory] = createSignal(true);
  const [showLayers, setShowLayers] = createSignal(true);
  const [showBins, setShowBins] = createSignal(false);
  const [popup, setPopup] = createSignal<'scale' | 'animal' | 'frame'>();
  /** The line drawn in the Set scale pop-up, applied only by Set scale. */
  const [scaleLine, setScaleLine] = createSignal<[Pt, Pt]>();

  let draft = newDraft(takeState());
  const [undoCount, setUndoCount] = createSignal(0);
  const frame0 = frame();
  const choice0 = JSON.stringify(videoChoice() ?? null);
  const [version, setVersion] = createSignal(0);

  const restore = (s: State) =>
    withoutNotice(() => {
      setArena(reconcile(s.arena));
      setSizeEntered(s.sizeEntered);
      setPendingZones(s.pending);
    });

  /** Run a change to the arena as one undoable edit. */
  function edit(change: () => void): void {
    draft = recordEdit(draft, takeState());
    setUndoCount(draft.past.length);
    change();
    setVersion((v) => v + 1);
  }
  function undo(): void {
    const { draft: d, restore: s } = undoEdit(draft);
    if (!s) return;
    draft = d;
    setUndoCount(d.past.length);
    setSelected(undefined);
    restore(s);
  }
  /** Whether anything changed since the editor opened (arena values, or the picture). */
  const dirty = () => {
    version();
    undoCount();
    return (
      isDirty(draft, takeState()) ||
      frame() !== frame0 ||
      JSON.stringify(videoChoice() ?? null) !== choice0
    );
  };
  /** Put the arena and picture back to how they were when the editor opened. */
  function discard(): void {
    if (!dirty()) return;
    withoutNotice(() => {
      setArena(reconcile(draft.start.arena));
      setSizeEntered(draft.start.sizeEntered);
      setPendingZones(draft.start.pending);
      if (frame() !== frame0) setFrame(frame0);
      setVideoChoice(choice0 === 'null' ? undefined : JSON.parse(choice0));
    });
  }
  const save = () => {
    draft = markSaved(takeState());
    setUndoCount(0);
  };

  const zoomBy = (k: number) => {
    const z = Math.min(MAX_ZOOM, Math.max(1, zoom() * k));
    const old = zoom();
    setZoom(z);
    if (z === 1) setPan([0, 0]);
    else setPan(([x, y]) => [(x * z) / old, (y * z) / old]);
  };
  const resetView = () => {
    setZoom(1);
    setPan([0, 0]);
  };

  return {
    tool,
    setTool,
    zoneShape,
    setZoneShape,
    zoneKind,
    setZoneKind,
    selected,
    setSelected,
    zoom,
    pan,
    setPan,
    zoomBy,
    resetView,
    showOccupancy,
    setShowOccupancy,
    showTrajectory,
    setShowTrajectory,
    showLayers,
    setShowLayers,
    showBins,
    setShowBins,
    popup,
    setPopup,
    scaleLine,
    setScaleLine,
    edit,
    undo,
    canUndo: () => undoCount() > 0,
    dirty,
    discard,
    save,
  };
}
export type ArenaEditor = ReturnType<typeof createArenaEditor>;
