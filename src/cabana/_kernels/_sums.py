"""Shift-sum kernels: per-state sums of per-cell series under circular shifts."""

from __future__ import annotations

import numpy as np


def shifted_sums(x: np.ndarray, columns: np.ndarray, shifts: np.ndarray) -> np.ndarray:
    """Per-column sums of ``x`` after each circular shift (dense matmul path).

    Parameters
    ----------
    x : (n_cells, n_time) float64
        Per-cell series (activity, ranks, ...).  NaN propagates into every
        column of that cell (``nan * 0 = nan`` in the product).
    columns : (n_time, n_cols) float64
        Indicator / weight matrix; frames outside the mask must already be 0.
    shifts : (n_shifts,) int64
        Any integer (negative and > n_time allowed); 0 = unshifted.

    Returns
    -------
    (n_shifts, n_cells, n_cols) float64
        ``out[i, c, j] = sum_t roll(x[c], shifts[i])[t] * columns[t, j]``, with
        ``roll(x, k)[t] = x[(t - k) mod n_time]``.
    """
    x = np.asarray(x, dtype=np.float64)
    columns = np.asarray(columns, dtype=np.float64)
    shifts = np.asarray(shifts, dtype=np.int64)
    n_cells, n_time = x.shape
    if columns.shape[0] != n_time:
        raise ValueError(f"columns has {columns.shape[0]} rows but x has {n_time} frames")
    out = np.empty((shifts.size, n_cells, columns.shape[1]), dtype=np.float64)
    for i, k in enumerate(shifts):
        # roll(x, k)[t] = x[t - k]  ==>  sum_t x[t-k] M[t] = sum_u x[u] M[u+k] = x @ roll(M, -k)
        out[i] = x @ np.roll(columns, -int(k), axis=0)
    return out


def shifted_label_sums(
    x: np.ndarray, labels: np.ndarray, n_states: int, shifts: np.ndarray
) -> np.ndarray:
    """Per-state sums of ``x`` after each circular shift, from integer labels.

    Parameters
    ----------
    x : (n_cells, n_time) float64
    labels : (n_time,) int32
        State index per frame; ``-1`` = skip (no state or masked out).
    n_states : int
    shifts : (n_shifts,) int64

    Returns
    -------
    (n_shifts, n_cells, n_states) float64
        ``out[i, c, s] = sum_{t: labels[t] == s} roll(x[c], shifts[i])[t]``.
        Identical to :func:`shifted_sums` with the masked one-hot, including NaN:
        a cell with any non-finite value in ``x`` (even at a skipped frame) is NaN
        in every state and shift.
    """
    x = np.asarray(x, dtype=np.float64)
    labels = np.asarray(labels)
    shifts = np.asarray(shifts, dtype=np.int64)
    n_cells, n_time = x.shape
    if labels.shape != (n_time,):
        raise ValueError(f"labels has shape {labels.shape} but x has {n_time} frames")
    out = np.zeros((shifts.size, n_cells, n_states), dtype=np.float64)
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


def masked_counts(labels: np.ndarray, n_states: int, mask: np.ndarray) -> np.ndarray:
    """Masked frames per state, float64 ``(n_states,)``, from labels (``-1`` skipped)."""
    labels = np.asarray(labels)
    sel = np.asarray(mask, dtype=bool) & (labels >= 0)
    return np.bincount(labels[sel], minlength=n_states).astype(np.float64)


def masked_counts_onehot(onehot: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Masked frames per state, float64 ``(n_states,)``, from a dense ``(n_time, n_states)`` bool."""
    return np.asarray(onehot)[np.asarray(mask, dtype=bool)].sum(axis=0, dtype=np.float64)
