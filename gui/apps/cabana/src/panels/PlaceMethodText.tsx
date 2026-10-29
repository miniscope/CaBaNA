import type { JSX } from 'solid-js';

/** One-paragraph summary of the place-cell analysis. */
export function PlaceIntro(): JSX.Element {
  return (
    <p>
      Identify cells whose activity varies with the animal’s location and whose spatial activity
      patterns are consistent over time. The analysis builds an activity map for each cell and tests
      spatial information and stability against time-shifted data. Cells must pass both tests to
      meet place-cell criteria.
    </p>
  );
}

/** How the place-cell analysis works. With `interpretation`, also what a result does and does not mean. */
export function PlaceMethodText(props: {
  interpretation?: boolean;
  notEvaluated?: boolean;
}): JSX.Element {
  return (
    <>
      <p>
        <strong>Build spatial activity maps:</strong> Divide the arena into spatial bins and
        calculate each cell’s event rate from its neural events and the time spent in each bin.
        Apply the selected speed filter, minimum time per bin (the spatial-tuning value, 0.05 s by
        default), and spatial smoothing.
      </p>
      <p>
        <strong>Measure spatial information and stability:</strong> Spatial information measures how
        strongly activity varies across locations. Stability measures how similar the cell’s spatial
        activity maps are between the first and second halves of the recording.
      </p>
      <p>
        <strong>Compare with time-shifted data:</strong> Repeatedly shift each cell’s neural
        activity relative to position (circularly, wrapping around the end of the recording) and
        recalculate both measures. This estimates the values expected without the original
        alignment between activity and location.
      </p>
      <p>
        <strong>Identify cells meeting the criteria:</strong> A cell qualifies when both measures
        are significant at the selected threshold. Place-field boundaries are calculated separately,
        with their own minimum time per bin, and do not determine whether the cell qualifies.
      </p>
      {props.interpretation && (
        <p>
          <strong>Reading the result:</strong> passing means the neural data is tied to position.
          Border cells and other spatially tuned cells can also pass, so it does not show a unique
          cell type. p-values are not corrected for the number of cells tested.
          {props.notEvaluated &&
            ' “Not evaluated” means a test had no defined result; it is not the same as failing.'}
        </p>
      )}
    </>
  );
}
