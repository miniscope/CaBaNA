"""Rate-map and Skaggs-information kernels, plus fold helpers."""

from __future__ import annotations

import numpy as np

from ._smooth import smooth_grid


def contiguous_folds(n: int, n_folds: int) -> np.ndarray:
    """Fold id ``(n,)`` int in ``0..n_folds-1`` of ``n`` time-ordered frames (equal contiguous blocks)."""
    if n_folds < 2:
        raise ValueError("n_folds must be >= 2")
    return (np.arange(n) * n_folds) // max(n, 1)


def valid_states(occupancy_frames: np.ndarray, fs: float, min_occupancy_s: float) -> np.ndarray:
    """``(n_states,)`` bool: occupancy_s >= ``min_occupancy_s`` and > 0."""
    occ_s = np.asarray(occupancy_frames, dtype=np.float64) / fs
    return (occ_s >= min_occupancy_s) & (occ_s > 0)


def rate_map(
    sums: np.ndarray,
    occupancy_frames: np.ndarray,
    fs: float,
    min_occupancy_s: float,
    shape: tuple[int, ...] | None = None,
    sigma: float = 0.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Per-state activity sums to rates (activity units per second).

    Parameters
    ----------
    sums : (..., n_states) float64
    occupancy_frames : (n_states,) float
    fs, min_occupancy_s : float
    shape : grid shape, required only when ``sigma > 0`` (see :func:`smooth_grid`)
    sigma : float
        > 0 smooths sums and occupancy (edge-normalised) before dividing.

    Returns
    -------
    rate : (..., n_states) float64, NaN where the state is invalid
    valid : (n_states,) bool
    """
    sums = np.asarray(sums, dtype=np.float64)
    occ_s = np.asarray(occupancy_frames, dtype=np.float64) / fs
    valid = valid_states(occupancy_frames, fs, min_occupancy_s)
    with np.errstate(divide="ignore", invalid="ignore"):
        if sigma > 0:
            if shape is None:
                raise ValueError("sigma > 0 requires a grid shape")
            s = smooth_grid(sums, valid, shape, sigma)
            o = smooth_grid(occ_s, valid, shape, sigma)
            rate = s / o
        else:
            rate = sums / occ_s
    rate[..., ~valid] = np.nan  # in place: ``rate`` is always a fresh array here
    return rate, valid


def split_half_masks(mask: np.ndarray, n_blocks: int) -> tuple[np.ndarray, np.ndarray]:
    """Two ``(n_time,)`` bool masks: even / odd contiguous blocks of the masked frames."""
    mask = np.asarray(mask, dtype=bool)
    idx = np.flatnonzero(mask)
    block = contiguous_folds(idx.size, n_blocks)
    half_a = np.zeros(mask.shape[0], dtype=bool)
    half_b = np.zeros(mask.shape[0], dtype=bool)
    half_a[idx[block % 2 == 0]] = True
    half_b[idx[block % 2 == 1]] = True
    return half_a, half_b


def skaggs_information(
    rate: np.ndarray, occ_frames: np.ndarray, valid: np.ndarray, per_second: bool
) -> np.ndarray:
    """Skaggs information (bits/event, or bits/s) over the last axis of ``rate``.

    ``rate`` (..., n_states) float64 (NaN allowed at invalid states),
    ``occ_frames`` (n_states,), ``valid`` (n_states,) bool.  Returns ``(...)``;
    NaN for a silent cell (mean rate <= 0) or when no state is valid.
    """
    occ = np.where(valid, occ_frames, 0.0).astype(np.float64)
    total = occ.sum()
    if total <= 0 or not valid.any():
        return np.full(rate.shape[:-1], np.nan)
    p = occ / total
    lam = np.where(valid, rate, 0.0)
    mean = (lam * p).sum(axis=-1)
    with np.errstate(divide="ignore", invalid="ignore"):
        rel = lam / mean[..., None]
        term = np.log2(rel, out=np.zeros_like(rel), where=lam > 0)  # 0 where lam <= 0
        term *= rel
        term *= p
    si = term.sum(axis=-1)
    si = np.where(mean > 0, si, np.nan)
    if per_second:
        si = si * mean
    return si
