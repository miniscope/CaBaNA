// "How to read this plot" text for each plot on the Data visualization page.

import type { JSX } from 'solid-js';

type Help = { title: string; text: JSX.Element };

export const HELP: Record<string, Help> = {
  footprints: {
    title: 'Cell footprints',
    text: (
      <>
        <p>
          The spatial footprint of each detected cell over the field of view. Colors only separate
          neighboring cells. White is the selected cell. Click a cell to select it.
        </p>
        <p>Footprints are model estimates, and overlapping cells may merge.</p>
      </>
    ),
  },
  trajectory: {
    title: 'Trajectory',
    text: (
      <>
        <p>
          The position of the animal from tracking. Gray: the whole session. Blue: the selected
          window. Red dot: the position at the hovered time.
        </p>
        <p>
          With the arena set up, the path is drawn on the arena picture with its zones. Otherwise it
          is scaled to fit the tracked positions. No axes are drawn.
        </p>
        <p>
          The bin view shows the time spent in each spatial bin, from low to high (the top of the
          scale is the 95th percentile of the open bins). Gray bins are excluded.
        </p>
      </>
    ),
  },
  raw: {
    title: 'Raw fluorescence',
    text: (
      <p>
        Extracted fluorescence of this cell before denoising, in the units of the loaded file
        (arbitrary). It includes noise and baseline drift.
      </p>
    ),
  },
  denoised: {
    title: 'Denoised trace',
    text: (
      <p>
        Fluorescence of this cell fitted by the denoising model, in the same arbitrary units. It is
        not ΔF/F unless the loaded data was.
      </p>
    ),
  },
  events: {
    title: 'Deconvolved events',
    text: (
      <p>
        Event amplitudes inferred by deconvolution: an estimate of when the cell became active, not
        measured spikes. Height is the inferred amplitude.
      </p>
    ),
  },
  heat: {
    title: 'Heat map (all cells)',
    text: (
      <>
        <p>
          Rows are cells in the order loaded (cell 1 at the top). Columns are time within the
          window. Color is the chosen signal, averaged within each pixel column.
        </p>
        <p>
          Each cell has its own scale, from its 5th to its 99.5th percentile over the whole session
          (dark: low, yellow: high). A cell is compared with itself, not with other cells. Long
          windows average out brief events.
        </p>
        <p>Click a row to select that cell. The white tick marks the selected cell.</p>
      </>
    ),
  },
  behavior: {
    title: 'Behavior',
    text: (
      <p>
        User-annotated behavior epochs, one row per label. A bar runs from the start to the stop of
        an epoch. Hidden tracks are chosen under Tracks.
      </p>
    ),
  },
  zone: {
    title: 'Zones',
    text: <p>When the animal is inside each zone defined in Experimental setup.</p>,
  },
  position: {
    title: 'Position',
    text: (
      <p>
        The x (blue) and y (orange) coordinates over time, in the position units of the loaded file.
        Both share one vertical scale.
      </p>
    ),
  },
  speed: {
    title: 'Speed',
    text: (
      <p>
        Speed in cm/s: the distance between consecutive tracked positions divided by the time
        between them. No smoothing is applied, so tracking jitter shows as spikes.
      </p>
    ),
  },
  navigator: {
    title: 'Session navigator',
    text: (
      <p>
        The whole session. The box is the selected window. Drag the box to move it, drag its edges
        to resize it, or click the strip to center the window there. The gray trace is the selected
        cell.
      </p>
    ),
  },
};
