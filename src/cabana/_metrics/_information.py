"""Skaggs spatial/behavioral information content."""

from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field

from .._models import StateSpace
from .._registry import Metric, register
from .._shuffle import shifted_sums
from ._ratemap import rate_maps_from_sums


def _si(rate: np.ndarray, occ_frames: np.ndarray, valid: np.ndarray, per_second: bool) -> np.ndarray:
    """Skaggs information over the last axis of ``rate`` (NaN where invalid)."""
    occ = np.where(valid, occ_frames, 0.0).astype(np.float64)
    total = occ.sum()
    if total <= 0 or not valid.any():
        return np.full(rate.shape[:-1], np.nan)
    p = occ / total
    lam = np.where(valid, rate, 0.0)
    mean = (lam * p).sum(axis=-1)
    with np.errstate(divide="ignore", invalid="ignore"):
        rel = lam / mean[..., None]
        term = np.where(lam > 0, p * rel * np.log2(rel), 0.0)
    si = term.sum(axis=-1)
    si = np.where(mean > 0, si, np.nan)  # a silent cell carries no information: undefined
    if per_second:
        si = si * mean
    return si


@register("metric")
class InformationContent(Metric):
    """Skaggs information: ``sum_i P_i (l_i/lbar) log2(l_i/lbar)``.

    ``P_i`` is occupancy probability over valid states (occupancy >=
    ``min_occupancy_s``), ``l_i`` the rate in state ``i`` and ``lbar`` the
    occupancy-weighted mean rate.  Cells with ``lbar <= 0`` or without any
    valid state get information 0.  ``units="bits_per_second"`` multiplies by
    ``lbar``.  ``weight="binary"`` uses ``activity > 0``.  Requires an
    exclusive state space.
    """

    name: ClassVar[str] = "information_content"
    default_tail: ClassVar[Literal["upper", "lower", "two"]] = "upper"

    units: Literal["bits_per_event", "bits_per_second"] = "bits_per_event"
    weight: Literal["amplitude", "binary"] = "amplitude"
    min_occupancy_s: float = Field(0.05, ge=0)
    smooth_sigma_bins: float = Field(0.0, ge=0)

    @staticmethod
    def _check_activity(activity: np.ndarray) -> None:
        if np.nanmin(activity) < 0:
            raise ValueError(
                "information_content needs non-negative activity (rates); z-scored or dF/F "
                "traces can go negative. Use weight='binary' after binarize_activity, or skip "
                "zscore_activity for this metric."
            )

    def check_states(self, states: StateSpace) -> None:
        super().check_states(states)
        if not states.exclusive:
            raise ValueError(
                f"information_content requires an exclusive state space but {states.name!r} "
                "is not exclusive; build it with bouts_to_states(exclusive=True)"
            )
        if self.smooth_sigma_bins > 0 and states.topology is None:
            raise ValueError("smooth_sigma_bins > 0 requires a state space with a GridTopology")

    def _x(self, activity: np.ndarray) -> np.ndarray:
        a = np.asarray(activity, dtype=np.float64)
        return (a > 0).astype(np.float64) if self.weight == "binary" else a

    def _maps(self, sums, occ, states, fs):
        return rate_maps_from_sums(
            sums, occ, fs, self.min_occupancy_s, states.topology, self.smooth_sigma_bins
        )

    def compute(self, activity, states, mask, fs):
        self.check_states(states)
        self._check_activity(activity)
        mask = np.asarray(mask, dtype=bool)
        m = states.masked(mask)
        sums = self._x(activity) @ m
        occ = m.sum(axis=0)
        rate, valid = self._maps(sums, occ, states, fs)
        return _si(rate, occ, valid, self.units == "bits_per_second")

    def compute_shifted(self, activity, states, mask, fs, shifts):
        self.check_states(states)
        self._check_activity(activity)
        mask = np.asarray(mask, dtype=bool)
        m = states.masked(mask)
        occ = m.sum(axis=0)
        sums = shifted_sums(self._x(activity), m, shifts)
        rate, valid = self._maps(sums, occ, states, fs)
        return _si(rate, occ, valid, self.units == "bits_per_second")

    def extras(self, activity, states, mask, fs):
        self.check_states(states)
        self._check_activity(activity)
        mask = np.asarray(mask, dtype=bool)
        m = states.masked(mask)
        occ = m.sum(axis=0)
        rate, valid = self._maps(self._x(activity) @ m, occ, states, fs)
        return {"rate_map": rate, "occupancy_s": occ / fs, "valid_states": valid}
