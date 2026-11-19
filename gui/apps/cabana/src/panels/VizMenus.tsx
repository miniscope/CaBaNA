// The Actions menu of each Data visualization box. Display settings are view only: they change
// what is drawn, never the data or the results, and the menu stays open so the plot updates live.

import type { JSX } from 'solid-js';
import { ActionsMenu } from '../components/ActionsMenu.tsx';
import type { MenuItem } from '../lib/actions-menu.ts';
import { groups, intensity, setIntensity, setShown, shown, showAll } from '../lib/overlay-state.ts';
import { colorBy, setColorBy } from '../lib/store.ts';
import {
  arenaShow,
  cellVisibility,
  footprintShow,
  setArenaShow,
  setCellVisibility,
  setFootprintShow,
  setTrajMode,
  trajMode,
} from '../lib/viz-display.ts';
import { forBox, type VizBox } from '../lib/viz-pills.ts';
import {
  heat,
  isOn,
  pos,
  rows,
  setChoice,
  setHeatSrc,
  SOURCE_LABEL,
  sources,
} from '../lib/viz-tracks.ts';
import { changes, openChanges } from './ChangesDrawer.tsx';
import { setRevertBox } from './RevertChanges.tsx';
import { placed } from './Trajectory.tsx';
import { PREPROCESS, REVIEW } from './VizChecks.tsx';

const NOT_YET = 'Not available yet';

const one = (
  label: string,
  checked: boolean,
  onSelect: () => void,
  disabled?: string,
): MenuItem => ({ kind: 'one', label, checked, onSelect, disabled });
const many = (label: string, checked: boolean, onToggle: (on: boolean) => void): MenuItem => ({
  kind: 'many',
  label,
  checked,
  onToggle,
});
/** A greyed row saying what a category needs, so an empty category explains itself. */
const needs = (label: string, reason: string): MenuItem => ({
  kind: 'action',
  label,
  disabled: reason,
  onSelect: () => {},
});
const category = (label: string, items: MenuItem[]): MenuItem => ({
  kind: 'category',
  label,
  items,
});

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Data version. The plots draw the data as loaded together with the corrections applied; a
 * separate original copy to switch to or draw beside it is not kept yet.
 */
const dataVersion = (): MenuItem =>
  category('Data version', [
    one('Current (processed)', true, () => {}),
    one('Original (as loaded)', false, () => {}, NOT_YET),
    one('Compare both', false, () => {}, NOT_YET),
  ]);

const neuralDisplay = (): MenuItem[] => [
  dataVersion(),
  category(
    'Heat map signal',
    sources().length
      ? sources().map((s) => one(sentence(SOURCE_LABEL[s]), heat() === s, () => setHeatSrc(s)))
      : [needs('Load neural data', 'Needed to draw the heat map.')],
  ),
  category(
    'Behavior overlays',
    groups().length
      ? [
          { kind: 'header', label: 'Intensity' },
          one('Subtle', intensity() === 'subtle', () => setIntensity('subtle')),
          one('Strong', intensity() === 'strong', () => setIntensity('strong')),
          { kind: 'separator' },
          { kind: 'header', label: 'Show' },
          { kind: 'action', label: 'Show all', keepOpen: true, onSelect: () => showAll(true) },
          { kind: 'action', label: 'Hide all', keepOpen: true, onSelect: () => showAll(false) },
          ...groups().flatMap((g) =>
            g.behaviors.map((b) => many(b.name, shown().has(b.name), (on) => setShown(b.name, on))),
          ),
        ]
      : [needs('Load behavior annotations', 'Needed to shade bouts over the plots.')],
  ),
];

const footprintDisplay = (): MenuItem[] => [
  category('Color map', [
    one('By cell', colorBy() === 'cell', () => setColorBy('cell')),
    one('By quality (green, amber, red)', colorBy() === 'quality', () => setColorBy('quality')),
  ]),
  category('Overlay', [
    many('Flagged cells (amber)', footprintShow.flagged, (on) => setFootprintShow('flagged', on)),
    many('Overlapping pairs (cyan)', footprintShow.overlap, (on) =>
      setFootprintShow('overlap', on),
    ),
    many('Selected cell (white)', footprintShow.selected, (on) => setFootprintShow('selected', on)),
  ]),
  category('Cell visibility', [
    one('All cells', cellVisibility() === 'all', () => setCellVisibility('all')),
    one('Hide rejected cells', cellVisibility() === 'hide-rejected', () =>
      setCellVisibility('hide-rejected'),
    ),
    one('Flagged cells only', cellVisibility() === 'flagged', () => setCellVisibility('flagged')),
  ]),
  { kind: 'separator' },
  many('Show cell outlines', footprintShow.outlines, (on) => setFootprintShow('outlines', on)),
];

const arenaDisplay = (): MenuItem[] => [
  category('Trajectory', [
    one('Path', trajMode() === 'path', () => setTrajMode('path')),
    one(
      'Time in bin',
      trajMode() === 'time',
      () => setTrajMode('time'),
      placed() ? undefined : 'Needs the arena set up',
    ),
  ]),
  category('Show', [
    many('Full session path', arenaShow.full, (on) => setArenaShow('full', on)),
    many('Selected window', arenaShow.window, (on) => setArenaShow('window', on)),
    many('Cursor', arenaShow.cursor, (on) => setArenaShow('cursor', on)),
    many('Zones', arenaShow.zones, (on) => setArenaShow('zones', on)),
    many('Excluded regions', arenaShow.excluded, (on) => setArenaShow('excluded', on)),
  ]),
  dataVersion(),
];

const behaviorDisplay = (): MenuItem[] => [
  category(
    'Show events',
    rows().length
      ? rows().map((r, i) => many(r.name, isOn(r.key, i), (on) => setChoice(r.key, on)))
      : [needs('Load behavior annotations or zones', 'Needed to draw the rows.')],
  ),
  category(
    'Trace display',
    pos()
      ? [
          many('Position (x, y)', isOn('position'), (on) => setChoice('position', on)),
          many('Speed', isOn('speed'), (on) => setChoice('speed', on)),
        ]
      : [needs('Load position', 'Needed to draw position and speed.')],
  ),
  dataVersion(),
];

const DISPLAY: Record<VizBox, () => MenuItem[]> = {
  footprints: footprintDisplay,
  neural: neuralDisplay,
  arena: arenaDisplay,
  behavior: behaviorDisplay,
};

/** The menu items of one box; "Expand view" is left out inside the expanded view itself. */
export function boxMenu(box: VizBox, expand?: () => void): MenuItem[] {
  const qc = REVIEW[box]();
  const prep = box === 'footprints' ? undefined : PREPROCESS[box]();
  const applied = forBox(changes(), box).length;
  const items: MenuItem[] = [
    {
      kind: 'action',
      label: 'Review QC',
      disabled: qc ? undefined : 'The file this review opens is not loaded.',
      onSelect: () => qc?.(),
    },
  ];
  if (box !== 'footprints')
    items.push({
      kind: 'action',
      label: 'Preprocess',
      disabled: prep ? undefined : 'The file this step acts on is not loaded.',
      onSelect: () => prep?.(),
    });
  items.push(
    { kind: 'separator' },
    category('Display settings', DISPLAY[box]()),
    { kind: 'action', label: 'View change history', onSelect: () => openChanges(box) },
    {
      kind: 'action',
      label: 'Revert changes',
      disabled: applied ? undefined : 'Nothing applied to this data.',
      onSelect: () => setRevertBox(box),
    },
  );
  if (expand)
    items.push({ kind: 'separator' }, { kind: 'action', label: 'Expand view', onSelect: expand });
  return items;
}

/** The Actions button of a box. The second panel opens to the left at the right edge, and upward at the bottom. */
export function BoxActions(props: {
  box: VizBox;
  /** Left out in the expanded view, where the menu has no "Expand view". */
  expand?: () => void;
  side?: 'left';
  up?: boolean;
}): JSX.Element {
  return (
    <ActionsMenu
      label="Actions"
      side={props.side}
      up={props.up}
      items={() => boxMenu(props.box, props.expand)}
    />
  );
}
