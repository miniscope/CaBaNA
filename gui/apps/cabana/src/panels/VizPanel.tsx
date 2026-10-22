import { Show, type JSX } from 'solid-js';
import {
  cell,
  deconvolved,
  denoisedTrace,
  footprints,
  rawTrace,
  positionResult,
  annotationResults,
} from '../lib/store.ts';
import { CellTraces } from './CellTraces.tsx';
import { FootprintViewer } from './FootprintViewer.tsx';
import { CellPicker, Note } from './parts.tsx';
import { SessionView } from './SessionView.tsx';
import { Trajectory } from './Trajectory.tsx';

/** Cell explorer: footprints on the left, the selected cell's traces on the right. */
function CellExplorer(): JSX.Element {
  const n = () =>
    (rawTrace() ?? denoisedTrace() ?? deconvolved())?.cells ?? footprints()?.cells ?? 0;
  return (
    <Show when={n() > 0}>
      <section class="cb-group">
        <h3>Cell explorer</h3>
        <Note>
          Click a cell on the footprint map, or use Previous and Next, to see that cell's traces.
          The cell you pick here is also the one shown in the session view below. White: selected
          cell. The other colors only tell neighboring cells apart.
        </Note>
        <CellPicker n={n()} />
        <div class="cb-muted">Selected: cell {cell() + 1}</div>
        <div class="cb-cellgrid" classList={{ 'cb-cellgrid--one': !footprints() }}>
          <Show when={footprints()}>
            <div>
              <div class="cb-label">Footprints (all cells)</div>
              <FootprintViewer />
            </div>
          </Show>
          <div>
            <CellTraces />
          </div>
        </div>
      </section>
    </Show>
  );
}

export function VizPanel(): JSX.Element {
  const anything = () =>
    rawTrace() ||
    denoisedTrace() ||
    deconvolved() ||
    footprints() ||
    positionResult() ||
    annotationResults().length;
  return (
    <div class="cb-panel cb-panel--wide">
      <h2>Data visualization</h2>
      <p class="cb-lead">
        Look at the data before analyzing it: cells, the whole session, and where the animal went.
      </p>
      <Show when={!anything()}>
        <div class="cb-empty">Load neural or behavior data to see it here.</div>
      </Show>
      <CellExplorer />
      <SessionView />
      <Trajectory />
    </div>
  );
}
