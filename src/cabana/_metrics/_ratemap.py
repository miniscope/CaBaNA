"""Shared helpers for rate-map based metrics (not a plugin)."""

from __future__ import annotations

import numpy as np
from .._kernels import (
    contiguous_folds,
    rate_map,
    smooth_grid,
    split_half_masks,
    valid_states,
)
from .._models import GridTopology, StateSpace


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


def smooth_over_grid(
    values: np.ndarray, valid: np.ndarray, topology: GridTopology, sigma: float
) -> np.ndarray:
    """Edge-normalised Gaussian smoothing of ``(..., n_states)`` over ``topology.shape``.

    Wrapper over :func:`cabana._kernels.smooth_grid` (see its semantics).
    """
    return smooth_grid(values, valid, tuple(topology.shape), sigma)


def rate_maps_from_sums(
    sums: np.ndarray,
    occupancy_frames: np.ndarray,
    fs: float,
    min_occupancy_s: float,
    topology: GridTopology | None,
    smooth_sigma_bins: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Per-state activity sums to rate maps (events/s); returns ``(rate, valid)``.

    Wrapper over :func:`cabana._kernels.rate_map`; ``topology`` is needed only
    when ``smooth_sigma_bins > 0``.  ``rate`` is NaN where the state is invalid.
    """
    if smooth_sigma_bins > 0 and topology is None:
        raise ValueError("smooth_sigma_bins > 0 requires a state space with a GridTopology")
    shape = None if topology is None else tuple(topology.shape)
    return rate_map(sums, occupancy_frames, fs, min_occupancy_s, shape, smooth_sigma_bins)


__all__ = [
    "contiguous_folds",
    "rate_maps_from_sums",
    "smooth_over_grid",
    "split_half_columns",
    "split_half_masks",
    "valid_states",
]
