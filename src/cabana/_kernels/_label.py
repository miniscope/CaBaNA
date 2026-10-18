"""Connected-component labelling and per-component statistics on N-D grids (numpy only)."""

from __future__ import annotations

import numpy as np


def _offsets(ndim: int, connectivity: int) -> list[tuple[int, ...]]:
    if connectivity < 1:
        raise ValueError("connectivity must be >= 1")
    if connectivity == 1:
        out = []
        for ax in range(ndim):
            for s in (-1, 1):
                d = [0] * ndim
                d[ax] = s
                out.append(tuple(d))
        return out
    grid = np.indices((3,) * ndim).reshape(ndim, -1).T - 1
    return [tuple(int(v) for v in d) for d in grid if d.any()]


def _slices(d: tuple[int, ...]) -> tuple[tuple[slice, ...], tuple[slice, ...]]:
    """``(dst, src)`` slices so that ``dst`` element ``i`` has neighbour ``src`` element ``i``."""
    dst, src = [], []
    for s in d:
        if s > 0:
            dst.append(slice(0, -s))
            src.append(slice(s, None))
        elif s < 0:
            dst.append(slice(-s, None))
            src.append(slice(0, s))
        else:
            dst.append(slice(None))
            src.append(slice(None))
    return tuple(dst), tuple(src)


def label_components(mask: np.ndarray, connectivity: int = 1) -> tuple[np.ndarray, int]:
    """Label the connected ``True`` regions of an N-D boolean grid.

    Parameters
    ----------
    mask : ndarray of bool, any ndim >= 1
    connectivity : int, default 1
        ``1`` joins face neighbours only; ``>= 2`` also joins diagonal neighbours
        (all ``3**ndim - 1`` neighbours).

    Returns
    -------
    labels : ndarray of int32, same shape as ``mask``
        ``0`` is background; components are ``1..n`` numbered by the C-order position of
        their first element.
    n : int
        Number of components.

    Notes
    -----
    Iterative minimum-label propagation with pointer jumping over flat indices: every
    foreground element starts as its own root and repeatedly adopts the smallest root among
    its neighbours until nothing changes.  No recursion; array shifts handle the borders.
    """
    mask = np.asarray(mask, dtype=bool)
    if mask.ndim < 1:
        raise ValueError("mask must have at least one dimension")
    if not mask.any():
        return np.zeros(mask.shape, dtype=np.int32), 0
    offs = [_slices(d) for d in _offsets(mask.ndim, connectivity)]
    big = np.iinfo(np.int64).max
    root = np.where(mask, np.arange(1, mask.size + 1, dtype=np.int64).reshape(mask.shape), big)
    while True:
        new = root.copy()
        for dst, src in offs:
            np.minimum(new[dst], root[src], out=new[dst])
        new[~mask] = big  # background never adopts a label
        flat = new.reshape(-1)
        fg = flat != big
        jump = flat.copy()
        jump[fg] = flat[flat[fg] - 1]  # pointer jumping: adopt the root's root
        new = jump.reshape(mask.shape)
        if np.array_equal(new, root):
            break
        root = new
    flat = root.reshape(-1)
    fg = flat != big
    _, inv = np.unique(flat[fg], return_inverse=True)
    labels = np.zeros(mask.size, dtype=np.int32)
    labels[fg] = inv.reshape(-1).astype(np.int32) + 1
    return labels.reshape(mask.shape), int(inv.max()) + 1


def component_stats(
    labels: np.ndarray, values: np.ndarray, weights: np.ndarray | None = None
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Per-component size, weighted centroid and peak location.

    Parameters
    ----------
    labels : ndarray of int, from :func:`label_components` (``0`` = background)
    values : ndarray, same shape; the peak of a component is its argmax (first on ties)
    weights : ndarray or None
        Centroid weights (default all ones); NaN weights count as 0.

    Returns
    -------
    size : (n,) int64 -- elements per component
    centroid : (n, ndim) float64 -- weighted mean grid index (NaN if the weights sum to 0)
    peak : (n,) int64 -- flat (C-order) index of each component's maximum of ``values``
    """
    labels = np.asarray(labels)
    n = int(labels.max()) if labels.size else 0
    flat_l = labels.reshape(-1)
    flat_v = np.asarray(values, dtype=np.float64).reshape(-1)
    w = (
        np.ones(flat_l.size)
        if weights is None
        else np.nan_to_num(np.asarray(weights, dtype=np.float64).reshape(-1))
    )
    coords = np.stack([c.reshape(-1) for c in np.indices(labels.shape)], axis=1).astype(np.float64)
    size = np.zeros(n, dtype=np.int64)
    centroid = np.full((n, labels.ndim), np.nan)
    peak = np.zeros(n, dtype=np.int64)
    for k in range(1, n + 1):
        idx = np.flatnonzero(flat_l == k)
        size[k - 1] = idx.size
        wk = w[idx]
        tot = wk.sum()
        if tot > 0:
            centroid[k - 1] = (coords[idx] * wk[:, None]).sum(axis=0) / tot
        peak[k - 1] = idx[np.argmax(flat_v[idx])]
    return size, centroid, peak
