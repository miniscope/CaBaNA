"""Memory-light per-state sums for exclusive state spaces.

A dense one-hot is the core :class:`~cabana.StateSpace` representation, but
turning it into a float64 ``(n_time, n_states)`` matrix and multiplying by it
costs ``O(n_cells * n_time * n_states)`` per shift and gigabytes of RAM for
fine grids (5 mm bins in 2-D: 6400 states; 3-D grids; many syllables).  When
the states are *exclusive* every frame belongs to at most one state, so the
per-state sum of a per-cell series is a bucketed sum over an integer label
vector: ``O(n_cells * n_valid_frames)`` per shift and no dense matrix.

Public helpers
--------------
:func:`state_labels`
    int32 label per frame (``-1`` = no state or masked out).
:func:`shifted_state_sums`
    ``(n_shifts, n_cells, n_states)`` sums from labels.
:func:`shifted_sums_for`, :func:`shifted_sums_multi`, :func:`state_sums`,
:func:`masked_counts`
    Dispatchers used by the metrics: the label path when
    ``states.exclusive``, otherwise the dense matmul of
    :func:`cabana._shuffle.shifted_sums`.  Both paths return the same values.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from ._models import StateSpace

# Below this many states the BLAS matmul with a dense indicator is faster than
# bucketing (crossover measured near 400 states at 200 cells x 24000 frames) and
# the indicator is small, so the dispatchers use the dense path.  Tests set it to
# 0 to force the label path.
DENSE_MAX_STATES = 256


def state_labels(states: StateSpace, mask: np.ndarray | None = None) -> np.ndarray:
    """State index per frame as int32; ``-1`` where no state is active or ``mask`` is False.

    Only meaningful for exclusive state spaces.
    """
    lab = states.labels(mask).astype(np.int32, copy=False)
    return lab


def shifted_state_sums(
    x: np.ndarray, labels: np.ndarray, n_states: int, shifts: np.ndarray
) -> np.ndarray:
    """Per-state sums of ``x`` after each circular shift, from integer labels.

    Parameters
    ----------
    x : (n_cells, n_time) float
    labels : (n_time,) int
        State index per frame, ``-1`` for frames to skip (see :func:`state_labels`).
    n_states : int
    shifts : (n_shifts,) int
        Frame offsets (any integer, negative and larger than ``n_time`` allowed).

    Returns
    -------
    (n_shifts, n_cells, n_states) float64
        ``out[i, c, s] = sum_{t: labels[t] == s} roll(x[c], shifts[i])[t]``;
        identical to ``shifted_sums(x, onehot_masked, shifts)``, including NaN
    handling: a cell with any non-finite value in ``x`` is NaN in every state
    and shift.

    Notes
    -----
    One ``np.bincount`` per (shift, cell) over the labelled frames, so the
    cost is ``O(n_cells * n_labelled)`` per shift independent of ``n_states``
    and the only allocation beyond the output is one ``n_labelled`` vector.
    (Benchmarked against a sort + ``np.add.reduceat`` variant and a single
    combined bincount: the per-cell bincount is fastest and leanest from about
    400 states upward.)
    """
    x = np.asarray(x, dtype=np.float64)
    labels = np.asarray(labels)
    shifts = np.asarray(shifts, dtype=np.int64)
    n_cells, n_time = x.shape
    if labels.shape != (n_time,):
        raise ValueError(f"labels has shape {labels.shape} but x has {n_time} frames")
    out = np.zeros((shifts.size, n_cells, n_states), dtype=np.float64)
    # Same NaN semantics as the dense matmul: one non-finite frame (even a masked-out
    # one) poisons the cell's whole row, since 0 * nan = nan in the product.
    bad = ~np.isfinite(x).all(axis=1)
    idx = np.flatnonzero(labels >= 0)
    if idx.size == 0 or n_cells == 0:
        out[:, bad, :] = np.nan
        return out
    lab = labels[idx].astype(np.intp)
    for i, k in enumerate(shifts):
        src = (idx - int(k)) % n_time
        for c in range(n_cells):
            if not bad[c]:
                out[i, c] = np.bincount(lab, weights=x[c, src], minlength=n_states)
    out[:, bad, :] = np.nan
    return out


def masked_counts(states: StateSpace, mask: np.ndarray) -> np.ndarray:
    """Masked frames per state, float64 ``(n_states,)`` (no dense float copy)."""
    mask = np.asarray(mask, dtype=bool)
    if states.exclusive and states.n_states > DENSE_MAX_STATES:
        lab = state_labels(states, mask)
        return np.bincount(lab[lab >= 0], minlength=states.n_states).astype(np.float64)
    return states.onehot[mask].sum(axis=0, dtype=np.float64)


def _dense_multi(x, states, masks, shifts, extra_columns, keep):
    from ._shuffle import shifted_sums

    cols = [states.masked(np.asarray(m, dtype=bool)) for m in masks]
    if keep is not None:
        cols = [c[:, keep] for c in cols]
    if extra_columns is not None:
        cols.append(np.asarray(extra_columns, dtype=np.float64))
    sums = shifted_sums(x, np.hstack(cols) if len(cols) > 1 else cols[0], shifts)
    sizes = np.cumsum([c.shape[1] for c in cols])[:-1]
    return np.split(sums, sizes, axis=-1)


def shifted_sums_multi(
    x: np.ndarray,
    states: StateSpace,
    masks: Sequence[np.ndarray],
    shifts: np.ndarray,
    *,
    extra_columns: np.ndarray | None = None,
    keep: np.ndarray | None = None,
) -> list[np.ndarray]:
    """One ``(n_shifts, n_cells, n_states)`` array per mask (e.g. split halves A and B).

    Equivalent to ``shifted_sums(x, hstack([states.masked(m) for m in masks]), shifts)``
    split per mask.  Exclusive spaces use integer labels; others use the dense
    matmul.  ``extra_columns`` ``(n_time, n_extra)`` (e.g. the mask itself) are
    summed densely and returned as a final extra array.  ``keep`` ``(n_states,)``
    bool restricts the output to those states (frames in other states are
    skipped), e.g. the valid states.
    """
    shifts = np.asarray(shifts, dtype=np.int64)
    if not states.exclusive or states.n_states <= DENSE_MAX_STATES:
        return _dense_multi(x, states, masks, shifts, extra_columns, keep)
    remap = None
    n_out = states.n_states
    if keep is not None:
        keep = np.asarray(keep, dtype=bool)
        n_out = int(keep.sum())
        remap = np.where(keep, np.cumsum(keep) - 1, -1).astype(np.int32)
    out = []
    for m in masks:
        lab = state_labels(states, np.asarray(m, dtype=bool))
        if remap is not None:
            lab = np.where(lab >= 0, remap[np.maximum(lab, 0)], -1)
        out.append(shifted_state_sums(x, lab, n_out, shifts))
    if extra_columns is not None:
        from ._shuffle import shifted_sums

        out.append(shifted_sums(x, extra_columns, shifts))
    return out


def shifted_sums_for(
    x: np.ndarray,
    states: StateSpace,
    mask: np.ndarray,
    shifts: np.ndarray,
    *,
    extra_columns: np.ndarray | None = None,
    keep: np.ndarray | None = None,
) -> np.ndarray:
    """Same as ``shifted_sums(x, states.masked(mask), shifts)``, without the dense copy if exclusive.

    ``extra_columns`` ``(n_time, n_extra)`` are appended as trailing columns
    (the label path sums them with a small dense matmul).  ``keep`` restricts the
    states, see :func:`shifted_sums_multi`.
    """
    parts = shifted_sums_multi(x, states, [mask], shifts, extra_columns=extra_columns, keep=keep)
    return parts[0] if len(parts) == 1 else np.concatenate(parts, axis=-1)


def state_sums(
    x: np.ndarray, states: StateSpace, mask: np.ndarray, *, keep: np.ndarray | None = None
) -> np.ndarray:
    """Unshifted per-state sums ``(n_cells, n_states)``: ``x @ states.masked(mask)``."""
    return shifted_sums_for(x, states, mask, np.zeros(1, dtype=np.int64), keep=keep)[0]


def frames_in_states(states: StateSpace, mask: np.ndarray, keep: np.ndarray) -> np.ndarray:
    """``(n_time,)`` bool: masked frames whose state is in ``keep`` (any kept state if overlapping)."""
    mask = np.asarray(mask, dtype=bool)
    keep = np.asarray(keep, dtype=bool)
    if not keep.any():
        return np.zeros(mask.shape[0], dtype=bool)
    if states.exclusive:
        lab = state_labels(states, mask)
        return (lab >= 0) & keep[np.maximum(lab, 0)]
    return states.onehot[:, keep].any(axis=1) & mask


__all__ = [
    "frames_in_states",
    "masked_counts",
    "shifted_state_sums",
    "shifted_sums_for",
    "shifted_sums_multi",
    "state_labels",
    "state_sums",
]
