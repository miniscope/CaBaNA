"""Discretising activity amplitude into levels (shared helper, not a plugin).

Rate-map metrics collapse a cell's activity in a state to its mean.  Metrics
that look at the *distribution* of amplitude per state (mutual information,
empirical-likelihood Bayesian decoding) first map every frame of every cell
to an integer level ``0..n_levels-1``; the joint ``(n_states, n_levels)``
histogram per cell is then one indicator matmul per level, so it rides the
same ``shifted_sums`` fast path as every other metric.

Conventions
-----------
* Edges are computed per cell on the *masked, unshifted* frames and reused
  for every surrogate, so observed and null are binned identically.
* For non-negative activity (deconvolved events, spike counts) level 0 is
  exactly zero ("silent") and the remaining levels split the positive
  values.  Deconvolved traces are mostly zero, so a bin of their own is the
  only way the other levels carry any mass.
* ``quantile`` edges give equal marginal mass per positive level; ``log`` and
  ``linear`` space the edges in amplitude.  ``binary`` is ``activity > 0``.
* Frames whose activity is NaN get level ``-1`` and fall out of every
  indicator, i.e. they are treated as unobserved.
"""

from __future__ import annotations

from typing import Literal

import numpy as np

from .._models import StateSpace
from .._shuffle import shifted_sums
from .._statesums import shifted_sums_for

Binning = Literal["quantile", "log", "linear", "binary"]


def level_edges(
    activity: np.ndarray, mask: np.ndarray, n_levels: int, binning: Binning
) -> np.ndarray:
    """Per-cell bin edges ``(n_cells, n_levels + 1)`` from the masked frames.

    Level ``k`` is ``edges[k] <= a < edges[k + 1]``; the last edge is ``+inf``.
    With non-negative data the first positive edge is the smallest positive
    value so level 0 is exactly ``a <= 0``.  Duplicate edges (heavily tied
    data) simply leave some levels empty.
    """
    a = np.asarray(activity, dtype=np.float64)
    mask = np.asarray(mask, dtype=bool)
    n_cells = a.shape[0]
    if binning == "binary":
        n_levels = 2
    if n_levels < 2:
        raise ValueError("n_levels must be >= 2")
    edges = np.full((n_cells, n_levels + 1), np.inf)
    edges[:, 0] = -np.inf
    am = a[:, mask]
    nonneg = bool(np.nanmin(am) >= 0) if am.size else True
    for c in range(n_cells):
        v = am[c]
        v = v[np.isfinite(v)]
        if binning == "binary":
            edges[c, 1] = np.nextafter(0.0, 1.0)  # level 1 is a > 0
            continue
        if nonneg:
            pos = v[v > 0]
            if pos.size == 0:  # silent cell: every frame is level 0
                continue
            lo = pos.min()
            inner = n_levels - 1  # levels 1..n_levels-1 split the positive values
            if binning == "quantile":
                q = np.quantile(pos, np.linspace(0, 1, inner + 1)[1:-1])
            elif binning == "log":
                q = np.geomspace(lo, pos.max(), inner + 1)[1:-1]
            else:
                q = np.linspace(lo, pos.max(), inner + 1)[1:-1]
            edges[c, 1] = lo
            edges[c, 2:n_levels] = q
        else:  # signed data (dF/F, z-scores): no silent level
            if v.size == 0:
                continue
            if binning == "quantile":
                q = np.quantile(v, np.linspace(0, 1, n_levels + 1)[1:-1])
            elif binning == "log":
                raise ValueError("binning='log' needs non-negative activity")
            else:
                q = np.linspace(v.min(), v.max(), n_levels + 1)[1:-1]
            edges[c, 1:n_levels] = q
    return edges


def activity_levels(activity: np.ndarray, edges: np.ndarray) -> np.ndarray:
    """Integer level ``(n_cells, n_time)`` of every frame; ``-1`` where activity is NaN."""
    a = np.asarray(activity, dtype=np.float64)
    out = np.empty(a.shape, dtype=np.int16)
    for c in range(a.shape[0]):
        out[c] = np.searchsorted(edges[c, 1:], a[c], side="right")
    out[~np.isfinite(a)] = -1
    return out


def level_indicator(levels: np.ndarray, level: int) -> np.ndarray:
    """``(n_cells, n_time)`` float indicator of ``levels == level``."""
    return (levels == level).astype(np.float64)


def joint_counts(
    levels: np.ndarray, columns: np.ndarray, n_levels: int, shifts: np.ndarray | None = None
) -> np.ndarray:
    """Joint (state, level) counts per cell.

    Parameters
    ----------
    levels : (n_cells, n_time) int
        From :func:`activity_levels`.
    columns : (n_time, n_cols) float
        Masked state indicators, e.g. ``states.masked(mask)``.
    n_levels : int
    shifts : (n_shifts,) int | None
        Circular shifts of the activity (see ``shifted_sums``).  ``None``
        means unshifted and drops the leading axis.

    Returns
    -------
    (n_shifts, n_cells, n_cols, n_levels) or (n_cells, n_cols, n_levels) float

    Notes
    -----
    Holds every level at once; for large ``n_shifts * n_cells * n_cols``
    accumulate per level with :func:`level_indicator` + ``shifted_sums``
    instead (mutual information only needs one level at a time because the
    level marginal is the sum over states of that level's counts).
    """
    sh = np.array([0]) if shifts is None else np.asarray(shifts)
    out = np.stack(
        [shifted_sums(level_indicator(levels, k), columns, sh) for k in range(n_levels)], axis=-1
    )
    return out[0] if shifts is None else out


def joint_counts_for(
    levels: np.ndarray,
    states: StateSpace,
    mask: np.ndarray,
    n_levels: int,
    *,
    keep: np.ndarray | None = None,
) -> np.ndarray:
    """Unshifted ``(n_cells, n_states_kept, n_levels)`` joint counts for a ``StateSpace``.

    Same values as ``joint_counts(levels, states.masked(mask)[:, keep], n_levels)``
    but exclusive spaces use integer labels instead of a dense float matrix.
    """
    sh = np.zeros(1, dtype=np.int64)
    return np.stack(
        [
            shifted_sums_for(level_indicator(levels, k), states, mask, sh, keep=keep)[0]
            for k in range(n_levels)
        ],
        axis=-1,
    )


__all__ = [
    "Binning",
    "activity_levels",
    "joint_counts",
    "joint_counts_for",
    "level_edges",
    "level_indicator",
]
