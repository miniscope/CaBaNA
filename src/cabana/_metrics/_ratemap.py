"""Shared helpers for rate-map based metrics (not a plugin)."""

from __future__ import annotations

import numpy as np
from scipy.ndimage import gaussian_filter

from .._models import GridTopology, StateSpace


def contiguous_folds(n: int, n_folds: int) -> np.ndarray:
    """Fold id (0..n_folds-1) for ``n`` time-ordered frames: equal-size contiguous blocks.

    Parameters
    ----------
    n : int
        Number of (already time-ordered) frames.
    n_folds : int
        Number of folds (>= 2).

    Returns
    -------
    (n,) int numpy.ndarray
        Non-decreasing fold index of each frame; fold sizes differ by at most one.

    Raises
    ------
    ValueError
        If ``n_folds < 2``.
    """
    if n_folds < 2:
        raise ValueError("n_folds must be >= 2")
    return (np.arange(n) * n_folds) // max(n, 1)


def valid_states(occupancy_frames: np.ndarray, fs: float, min_occupancy_s: float) -> np.ndarray:
    """Boolean ``(n_states,)``: occupancy of at least ``min_occupancy_s`` and never zero.

    The ``> 0`` guard means a never-visited state is invalid even when
    ``min_occupancy_s == 0``.

    Parameters
    ----------
    occupancy_frames : (n_states,) array
        Masked frames spent in each state.
    fs : float
        Sampling rate (Hz).
    min_occupancy_s : float
        Minimum occupancy in seconds.

    Returns
    -------
    (n_states,) bool numpy.ndarray
    """
    occ_s = np.asarray(occupancy_frames, dtype=np.float64) / fs
    return (occ_s >= min_occupancy_s) & (occ_s > 0)


def smooth_over_grid(
    values: np.ndarray, valid: np.ndarray, topology: GridTopology, sigma: float
) -> np.ndarray:
    """Edge-normalised Gaussian smoothing of ``(..., n_states)`` over a state grid.

    ``values`` and the ``valid`` indicator (``(n_states,)``) are each smoothed with
    ``mode="constant"`` and the former divided by the latter, so grid edges and
    invalid states do not bias the result low.  Entries whose smoothed valid
    indicator is 0 (no valid state within the kernel) are returned as 0.

    Parameters
    ----------
    values : (..., n_states) float
        Per-state quantity (sums or occupancy); leading axes are smoothed
        independently (no smoothing across them).
    valid : (n_states,) bool
        Which states have data.
    topology : GridTopology
        Grid layout; the state axis is reshaped to ``topology.shape``.
    sigma : float
        Gaussian standard deviation in grid bins (same on every axis).

    Returns
    -------
    numpy.ndarray
        Same shape as ``values``.
    """
    shape = tuple(topology.shape)
    values = np.asarray(values, dtype=np.float64)

    def filt(a: np.ndarray) -> np.ndarray:
        a = a.reshape(*a.shape[:-1], *shape)
        sig = (0.0,) * (a.ndim - len(shape)) + (float(sigma),) * len(shape)
        return gaussian_filter(a, sigma=sig, mode="constant")

    norm = filt(np.asarray(valid, dtype=np.float64)).reshape(-1)
    out = filt(values).reshape(values.shape)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(norm > 0, out / norm, 0.0)


def rate_maps_from_sums(
    sums: np.ndarray,
    occupancy_frames: np.ndarray,
    fs: float,
    min_occupancy_s: float,
    topology: GridTopology | None,
    smooth_sigma_bins: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Turn per-state activity sums into rate maps (events/s per state).

    Parameters
    ----------
    sums : (..., n_states)
        Summed activity per state; leading axes (shifts, cells) are kept.
    occupancy_frames : (n_states,)
        Frames spent in each state.
    fs, min_occupancy_s : float
        Sampling rate and minimum occupancy (s) for a state to be valid.
    topology : GridTopology | None
        Needed only when ``smooth_sigma_bins > 0``.
    smooth_sigma_bins : float
        Gaussian sigma in grid bins.  Sums, occupancy and the valid mask are
        smoothed with ``mode="constant"`` and sums/occupancy are divided by the
        smoothed valid mask (edge normalisation), so edges are not biased low.

    Returns
    -------
    rate : (..., n_states) with NaN where the state is invalid.
    valid : (n_states,) bool, ``raw occupancy_s >= min_occupancy_s``.
    """
    sums = np.asarray(sums, dtype=np.float64)
    occ_s = np.asarray(occupancy_frames, dtype=np.float64) / fs
    valid = valid_states(occupancy_frames, fs, min_occupancy_s)
    with np.errstate(divide="ignore", invalid="ignore"):
        if smooth_sigma_bins > 0:
            if topology is None:
                raise ValueError("smooth_sigma_bins > 0 requires a state space with a GridTopology")
            s = smooth_over_grid(sums, valid, topology, smooth_sigma_bins)
            o = smooth_over_grid(occ_s, valid, topology, smooth_sigma_bins)
            rate = s / o
        else:
            rate = sums / occ_s
    rate[..., ~valid] = np.nan  # in place: ``rate`` is always a fresh array here
    return rate, valid


def split_half_masks(mask: np.ndarray, n_blocks: int) -> tuple[np.ndarray, np.ndarray]:
    """Boolean masks of the two interleaved halves of the masked frames.

    Masked frames are cut into ``n_blocks`` contiguous blocks of (nearly)
    equal count; even blocks form half A, odd blocks half B.  Both masks are
    subsets of ``mask``.
    """
    mask = np.asarray(mask, dtype=bool)
    idx = np.flatnonzero(mask)
    block = contiguous_folds(idx.size, n_blocks)
    half_a = np.zeros(mask.shape[0], dtype=bool)
    half_b = np.zeros(mask.shape[0], dtype=bool)
    half_a[idx[block % 2 == 0]] = True
    half_b[idx[block % 2 == 1]] = True
    return half_a, half_b


def split_half_columns(
    states: StateSpace, mask: np.ndarray, n_blocks: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Indicator matrices for two interleaved halves of the masked frames.

    Masked frames are cut into ``n_blocks`` contiguous blocks of (nearly)
    equal count; even blocks form half A, odd blocks half B.

    Returns ``(M_a, M_b, half_a_mask, half_b_mask)``.
    """
    mask = np.asarray(mask, dtype=bool)
    idx = np.flatnonzero(mask)
    n = idx.size
    block = contiguous_folds(n, n_blocks)
    half_a = np.zeros(mask.shape[0], dtype=bool)
    half_b = np.zeros(mask.shape[0], dtype=bool)
    half_a[idx[block % 2 == 0]] = True
    half_b[idx[block % 2 == 1]] = True
    return states.masked(mask & half_a), states.masked(mask & half_b), half_a, half_b
