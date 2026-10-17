"""Rank / Mann-Whitney kernels for AUROC.

Threading and shift loops live in the metric; the kernels here are the
per-series and per-shift pieces (all exact in float64: ranks are half-integers).
"""

from __future__ import annotations

import numpy as np


def average_ranks(x: np.ndarray) -> np.ndarray:
    """Average (tie-mean) 1-based ranks along the last axis of a 2-D array.

    ``x`` (n_cells, n_time) float64 -> (n_cells, n_time) float64.  A row with
    any NaN is returned entirely NaN (matches ``scipy.stats.rankdata`` with
    ``nan_policy="propagate"``).
    """
    x = np.asarray(x, dtype=np.float64)
    out = np.empty(x.shape, dtype=np.float64)
    n = x.shape[1]
    for c in range(x.shape[0]):
        s = x[c]
        if np.isnan(s).any():
            out[c] = np.nan
            continue
        o = np.argsort(s, kind="mergesort")
        ss = s[o]
        new = np.empty(n, dtype=bool)
        new[:1] = True
        new[1:] = ss[1:] != ss[:-1]
        grp = np.cumsum(new) - 1
        starts = np.flatnonzero(new)
        ends = np.append(starts[1:], n)
        out[c, o] = ((starts + ends + 1) / 2.0)[grp]
    return out


def dense_ranks(x: np.ndarray) -> tuple[np.ndarray, int]:
    """Dense ranks ``(n_cells, n_time)`` intp (0-based, ties equal) and the max distinct count."""
    n_cells, n_time = x.shape
    dense = np.empty((n_cells, n_time), dtype=np.intp)
    n_distinct = np.empty(n_cells, dtype=np.intp)
    for c in range(n_cells):
        u, inv = np.unique(x[c], return_inverse=True)
        dense[c] = inv.reshape(-1)
        n_distinct[c] = u.size
    return dense, int(n_distinct.max())


def masked_rank_sums_one_shift(
    dense: np.ndarray,
    width: int,
    idx: np.ndarray,
    shift: int,
    onehot_masked: np.ndarray,
    half_n1: np.ndarray,
) -> np.ndarray:
    """In-state rank sums ``R1 (n_cells, n_states)`` of the rolled, masked series for one shift.

    ``dense``/``width`` from :func:`dense_ranks`; ``idx`` = ``flatnonzero(mask)``;
    ``onehot_masked`` (n_masked, n_states) float64 = state indicator on masked
    frames; ``half_n1`` = ``0.5 * onehot_masked.sum(0)``.  With
    ``F(i) = #{j < i} + 0.5 #{j == i}`` from a per-cell histogram of the rolled
    dense ranks, ``R1 = sum_{i in state} F(i) + n1/2`` (exact with ties, no sort).
    """
    n_cells, n_time = dense.shape
    offs = (np.arange(n_cells, dtype=np.intp) * width)[:, None]
    cols = (idx - int(shift)) % n_time  # roll(x, k)[t] = x[t - k]
    flat = dense[:, cols]
    flat += offs
    h = np.bincount(flat.ravel(), minlength=n_cells * width)
    f_table = np.cumsum(h.reshape(n_cells, width), axis=1) - 0.5 * h.reshape(n_cells, width)
    return np.take(f_table.ravel(), flat) @ onehot_masked + half_n1


def auroc_from_rank_sums(
    r1: np.ndarray, n1: np.ndarray, n0: np.ndarray, min_frames: int
) -> np.ndarray:
    """``(r1 - n1 (n1+1)/2) / (n1 n0)``; NaN where ``n1`` or ``n0`` < ``min_frames``.

    ``r1`` (..., n_cells, n_states); ``n1``, ``n0`` (n_states,).
    """
    ok = (n1 >= min_frames) & (n0 >= min_frames)
    with np.errstate(invalid="ignore", divide="ignore"):
        auc = (r1 - n1 * (n1 + 1) / 2.0) / (n1 * n0)
    return np.where(ok, auc, np.nan)
