"""Shared helpers for rate-map based metrics (not a plugin)."""

from __future__ import annotations

import numpy as np
from scipy.ndimage import gaussian_filter

from .._models import GridTopology, StateSpace


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
    valid = (occ_s >= min_occupancy_s) & (occ_s > 0)
    with np.errstate(divide="ignore", invalid="ignore"):
        if smooth_sigma_bins > 0:
            if topology is None:
                raise ValueError("smooth_sigma_bins > 0 requires a state space with a GridTopology")
            shape = tuple(topology.shape)

            def filt(a: np.ndarray) -> np.ndarray:
                a = a.reshape(*a.shape[:-1], *shape)
                sigma = (0.0,) * (a.ndim - len(shape)) + (float(smooth_sigma_bins),) * len(shape)
                return gaussian_filter(a, sigma=sigma, mode="constant")

            norm = filt(valid.astype(np.float64))
            s = filt(sums) / norm
            o = filt(occ_s) / norm
            s = s.reshape(sums.shape)
            o = o.reshape(occ_s.shape)
            rate = s / o
        else:
            rate = sums / occ_s
    rate = np.where(valid, rate, np.nan)
    return rate, valid


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
    block = (np.arange(n) * n_blocks) // max(n, 1)
    half_a = np.zeros(mask.shape[0], dtype=bool)
    half_b = np.zeros(mask.shape[0], dtype=bool)
    half_a[idx[block % 2 == 0]] = True
    half_b[idx[block % 2 == 1]] = True
    return states.masked(mask & half_a), states.masked(mask & half_b), half_a, half_b
