"""Split-half rate-map stability."""

from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field

from .._registry import Metric, register
from .._shuffle import shifted_sums
from ._ratemap import rate_maps_from_sums, split_half_columns


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
    if either map is constant.  Works for exclusive and overlapping states.
    """

    name: ClassVar[str] = "split_half_stability"
    default_tail: ClassVar[Literal["upper", "lower", "two"]] = "upper"

    n_blocks: int = Field(2, ge=2)
    min_occupancy_s: float = Field(0.05, ge=0)
    smooth_sigma_bins: float = Field(0.0, ge=0)

    def _check(self, states):
        self.check_states(states)
        if self.smooth_sigma_bins > 0 and states.topology is None:
            raise ValueError("smooth_sigma_bins > 0 requires a state space with a GridTopology")

    def _maps(self, sums, occ_a, occ_b, states, fs):
        n = occ_a.shape[0]
        ra, va = rate_maps_from_sums(
            sums[..., :n], occ_a, fs, self.min_occupancy_s, states.topology, self.smooth_sigma_bins
        )
        rb, vb = rate_maps_from_sums(
            sums[..., n:], occ_b, fs, self.min_occupancy_s, states.topology, self.smooth_sigma_bins
        )
        return ra, rb, va & vb

    def _setup(self, states, mask):
        self._check(states)
        m_a, m_b, _, _ = split_half_columns(states, np.asarray(mask, dtype=bool), self.n_blocks)
        return m_a, m_b, m_a.sum(axis=0), m_b.sum(axis=0)

    def compute(self, activity, states, mask, fs):
        m_a, m_b, occ_a, occ_b = self._setup(states, mask)
        x = np.asarray(activity, dtype=np.float64)
        sums = np.concatenate([x @ m_a, x @ m_b], axis=-1)
        ra, rb, both = self._maps(sums, occ_a, occ_b, states, fs)
        return _pearson_valid(ra, rb, both)

    def compute_shifted(self, activity, states, mask, fs, shifts):
        m_a, m_b, occ_a, occ_b = self._setup(states, mask)
        sums = shifted_sums(activity, np.hstack([m_a, m_b]), shifts)
        ra, rb, both = self._maps(sums, occ_a, occ_b, states, fs)
        return _pearson_valid(ra, rb, both)

    def extras(self, activity, states, mask, fs):
        m_a, m_b, occ_a, occ_b = self._setup(states, mask)
        x = np.asarray(activity, dtype=np.float64)
        sums = np.concatenate([x @ m_a, x @ m_b], axis=-1)
        ra, rb, both = self._maps(sums, occ_a, occ_b, states, fs)
        return {"rate_map_a": ra, "rate_map_b": rb, "valid_states": both}
