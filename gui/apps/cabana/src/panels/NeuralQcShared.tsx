// What the Neural QC tests share: recommendation words, check lists, flagged cells and the footprint map.
import type { JSX } from 'solid-js';
import { eventTraceCheckList } from '../lib/decon-state.ts';
import type { Level } from '../lib/cells.ts';
import { cellScores, colorBy, neuralChecks, setColorBy } from '../lib/store.ts';
import { FootprintViewer } from './FootprintViewer.tsx';
import { Help } from './QcParts.tsx';

export const WORD: Record<Level, string> = { good: 'Accept', warn: 'Check', bad: 'Reject' };

export const cellChecks = () => [
  ...neuralChecks().filter((c) => !c.id.startsWith('fp-')),
  ...eventTraceCheckList(),
];
export const footprintCheckList = () => neuralChecks().filter((c) => c.id.startsWith('fp-'));
export const overlapPairs = () =>
  footprintCheckList().find((c) => c.id === 'fp-overlap')?.pairs ?? [];

/** Cells with a Check or Reject recommendation that are not rejected yet. */
export const flaggedCells = () =>
  (cellScores() ?? [])
    .map((s, c) => ({ s, c }))
    .filter((x) => x.s.overall !== 'good' && !x.s.rejected);

export const ColorBy = (): JSX.Element => (
  <label class="cb-plot__tool">
    Color by
    <select
      value={colorBy()}
      onChange={(e) => setColorBy(e.currentTarget.value as 'cell' | 'quality')}
    >
      <option value="cell">Cell</option>
      <option value="quality">Quality (green, amber, red)</option>
    </select>
  </label>
);

/** One legend for the footprint highlights. */
export const MapKey = (): JSX.Element => (
  <div class="cb-map-key">
    White: selected · Orange: most correlated neighbor · Cyan: overlapping partner
  </div>
);

/** The footprint map as a square that fits the card. */
export const SquareMap = (props: { w: number; h: number }): JSX.Element => {
  const side = () => `${Math.max(40, Math.min(props.w, props.h - 20))}px`;
  return (
    <>
      <div style={{ width: side(), height: side(), margin: '0 auto' }}>
        <FootprintViewer partners />
      </div>
      <MapKey />
    </>
  );
};

export const FOOTPRINT_HELP = (
  <>
    <Help k="What is plotted">
      All cell footprints in one image. Each cell's pixels above a quarter of its own peak are
      drawn, brighter closer to the peak. The overlap check counts only pixels above half the peak.
    </Help>
    <Help k="Axes">Pixels of the field of view, as exported by the extraction.</Help>
    <Help k="Colors">
      White: the selected cell. Orange: the neighbor it correlates with most. Cyan: the overlapping
      partner picked from the pairs list. Dark gray: rejected cells. Other cells take a color per
      cell, or green, amber or red by recommendation when Color by is Quality.
    </Help>
    <Help k="Linked">
      Clicking a cell selects it everywhere: the traces, the cell bar and the lists.
    </Help>
    <Help k="Limits">
      Where footprints overlap, each pixel shows the cell that is brightest there relative to its
      own peak, except that the selected cell is drawn whole. Overlap is judged from shared pixels,
      not from the traces.
    </Help>
  </>
);
