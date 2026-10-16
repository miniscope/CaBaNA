"""Split-half rate-map stability."""

from __future__ import annotations

from typing import ClassVar

import numpy as np
from pydantic import Field

from .._models import StateSpace
from .._registry import Metric, register
from .._results import Tail
from .._statesums import masked_counts, shifted_sums_multi
from ._ratemap import rate_maps_from_sums, split_half_masks


def _pearson_valid(a: np.ndarray, b: np.ndarray, both: np.ndarray) -> np.ndarray:
    """Pearson r over the last axis restricted to ``both``; NaN if < 3 states."""
    if both.sum() < 3:
        return np.full(a.shape[:-1], np.nan)
    a = a[..., both]
    b = b[..., both]
    a = a - a.mean(axis=-1, keepdims=True)
    b = b - b.mean(axis=-1, keepdims=True)
    num = (a * b).sum(axis=-1)
    den = np.sqrt((a * a).sum(axis=-1) * (b * b).sum(axis=-1))
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(den > 0, num / den, np.nan)


@register("metric")
class SplitHalfStability(Metric):
    """Pearson r between rate maps of two interleaved halves of the data.

    Masked frames are split into ``n_blocks`` contiguous blocks; even blocks
    form half A, odd blocks half B.  r is taken across states valid (occupancy
    >= ``min_occupancy_s``) in both halves; NaN if fewer than 3 such states or
    if either map is constant.

    Parameters
    ----------
    n_blocks : int, default 2
        Number of contiguous blocks the masked frames are cut into (>= 2); even
        blocks form half A, odd blocks half B.
    min_occupancy_s : float, default 0.05
        Minimum occupancy (s) of a state *within each half* for it to be valid.
    smooth_sigma_bins : float, default 0.0
        Gaussian sigma in grid bins applied to each half's maps; ``> 0``
        requires a state space with a ``GridTopology``.

    Returns
    -------
    numpy.ndarray
        ``compute`` returns shape ``(n_cells,)``: Pearson r in [-1, 1].

    Notes
    -----
    **Tail.**  ``"upper"``: only a positive correlation indicates a stable map.

    **State space.**  Exclusive or overlapping; a topology is needed only for
    smoothing.  Activity is not restricted to a kind.

    Extras: ``rate_map_a`` and ``rate_map_b`` ``(n_cells, n_states)`` rate maps
    of each half (activity units per second; NaN for states invalid in that
    half), ``valid_states`` ``(n_states,)`` bool, states valid in both halves
    (the ones entering the correlation).
    """

    name: ClassVar[str] = "split_half_stability"
    default_tail: ClassVar[Tail] = "upper"

    n_blocks: int = Field(
        2, ge=2, description="Number of contiguous blocks; even blocks are half A, odd half B."
    )
    min_occupancy_s: float = Field(
        0.05, ge=0, description="Minimum occupancy (s) per half for a state to be valid."
    )
    smooth_sigma_bins: float = Field(
        0.0, ge=0, description="Gaussian map smoothing in grid bins (needs a grid topology)."
    )

    def check_target(self, target: StateSpace) -> None:
        super().check_target(target)
        self.require_topology_for_smoothing(target)

    def _maps(self, sums_a, sums_b, occ_a, occ_b, states, fs):
        ra, va = rate_maps_from_sums(
            sums_a, occ_a, fs, self.min_occupancy_s, states.topology, self.smooth_sigma_bins
        )
        rb, vb = rate_maps_from_sums(
            sums_b, occ_b, fs, self.min_occupancy_s, states.topology, self.smooth_sigma_bins
        )
        return ra, rb, va & vb

    def _setup(self, states, mask):
        self.check_target(states)
        half_a, half_b = split_half_masks(np.asarray(mask, dtype=bool), self.n_blocks)
        return half_a, half_b, masked_counts(states, half_a), masked_counts(states, half_b)

    def _unshifted(self, activity, states, mask):
        half_a, half_b, occ_a, occ_b = self._setup(states, mask)
        s_a, s_b = shifted_sums_multi(
            np.asarray(activity, dtype=np.float64), states, [half_a, half_b], np.zeros(1, np.int64)
        )
        return s_a[0], s_b[0], occ_a, occ_b

    def compute(self, activity, states, mask, fs):
        s_a, s_b, occ_a, occ_b = self._unshifted(activity, states, mask)
        ra, rb, both = self._maps(s_a, s_b, occ_a, occ_b, states, fs)
        return _pearson_valid(ra, rb, both)

    def compute_shifted(self, activity, states, mask, fs, shifts):
        half_a, half_b, occ_a, occ_b = self._setup(states, mask)
        s_a, s_b = shifted_sums_multi(
            np.asarray(activity, dtype=np.float64), states, [half_a, half_b], shifts
        )
        ra, rb, both = self._maps(s_a, s_b, occ_a, occ_b, states, fs)
        return _pearson_valid(ra, rb, both)

    def extras(self, activity, states, mask, fs):
        s_a, s_b, occ_a, occ_b = self._unshifted(activity, states, mask)
        ra, rb, both = self._maps(s_a, s_b, occ_a, occ_b, states, fs)
        return {"rate_map_a": ra, "rate_map_b": rb, "valid_states": both}
