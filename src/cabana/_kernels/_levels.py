"""Amplitude-level discretisation, joint counts and plug-in mutual information."""

from __future__ import annotations

from typing import Literal

import numpy as np

from ._sums import shifted_sums

_LN2 = float(np.log(2.0))


def level_edges(
    activity: np.ndarray,
    mask: np.ndarray,
    n_levels: int,
    binning: Literal["quantile", "log", "linear", "binary"],
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


def mutual_information_from_counts(
    counts: np.ndarray, bias_correction: Literal["none", "miller_madow"] = "none"
) -> np.ndarray:
    """Plug-in mutual information (bits) over the last two axes.

    Parameters
    ----------
    counts : (..., n_states, n_levels) float
        Joint counts ``n(s, l)``.
    bias_correction : {"none", "miller_madow"}
        ``"miller_madow"`` adds ``[(Ks - 1) + (Kl - 1) - (Kj - 1)] / (2 N ln 2)``
        where ``Ks``, ``Kl``, ``Kj`` are the numbers of non-empty state, level and
        joint cells (the Miller-Madow entropy correction applied to
        ``H(S) + H(L) - H(S, L)``); it lowers the estimate.

    Returns
    -------
    (...) float
        ``sum p(s,l) log2[p(s,l) / (p(s) p(l))]`` with ``0 log 0 = 0``; NaN
        where the total count is zero.
    """
    n = np.asarray(counts, dtype=np.float64)
    total = n.sum(axis=(-2, -1))
    ns = n.sum(axis=-1, keepdims=True)
    nl = n.sum(axis=-2, keepdims=True)
    with np.errstate(divide="ignore", invalid="ignore"):
        ratio = n * total[..., None, None] / (ns * nl)
        mi = np.where(n > 0, n * np.log2(ratio), 0.0).sum(axis=(-2, -1)) / total
        if bias_correction == "miller_madow":
            ks = (ns[..., 0] > 0).sum(axis=-1)
            kl = (nl[..., 0, :] > 0).sum(axis=-1)
            kj = (n > 0).sum(axis=(-2, -1))
            mi = mi + (ks + kl - kj - 1) / (2.0 * total * _LN2)
    return np.where(total > 0, mi, np.nan)
