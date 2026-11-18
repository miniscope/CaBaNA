// The PETH method text, shown by How it works in the Configure settings window.
import type { JSX } from 'solid-js';

/** What PETH does, for the How it works button. */
export function PethMethodText(): JSX.Element {
  return (
    <>
      <p>
        <strong>Align:</strong> Each bout of a behavior gives one aligned frame, its first frame
        (onset) or the first frame after it (offset). Bouts that are too short, too close to the
        neighboring bout, or too near the recording edge are left out.
      </p>
      <p>
        <strong>Average:</strong> The deconvolved events of each cell are cut out around every
        included bout and averaged, giving a mean curve over the window.
      </p>
      <p>
        <strong>Test:</strong> The response is the mean in the response interval minus the mean in
        the baseline interval, averaged over bouts. It is compared with the same value after
        circular shifts of the cell's trace, which keep the cell's own rhythm but break its link to
        the bouts. A cell is higher or lower when the p-value is below α. Max-stat correction
        accounts for the number of behaviors tested within each cell, not for the number of cells.
      </p>
      <p>
        <strong>Descriptive only:</strong> The null band, latency and Wilcoxon p-value do not change
        which cells are labeled.
      </p>
    </>
  );
}
