"""Tuning of activity to a circular signal such as head direction (``input = "signal"``)."""

from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field

from .._registry import Metric, register
from .._results import Tail
from .._shuffle import shifted_sums
from ._continuous import _as_1d


def _circular_kernel(n_bins: int, sigma_bins: float) -> np.ndarray:
    """Circulant ``(n_bins, n_bins)`` Gaussian smoothing matrix (columns sum to 1)."""
    d = np.arange(n_bins)
    delta = np.abs(d[:, None] - d[None, :])
    delta = np.minimum(delta, n_bins - delta)
    k = np.exp(-0.5 * (delta / sigma_bins) ** 2)
    return k / k.sum(axis=0, keepdims=True)


@register("metric")
class CircularTuning(Metric):
    """Mean vector length of a cell's tuning curve to a circular signal (head direction).

    The angle signal is cut into ``n_bins`` equal bins over the full circle.  Frames
    where the angle is NaN or outside the mask are dropped.  The tuning curve is the
    occupancy-normalised mean activity per bin (activity units per frame); bins with
    less than ``min_occupancy_s`` of occupancy are invalid.  With
    ``smooth_sigma_bins > 0`` the curve is smoothed with a wrap-around Gaussian over
    valid bins (renormalised near invalid bins; with all bins valid it conserves the
    curve sum).

    ``statistic="mvl"`` is the mean vector length ``|sum_b r_b exp(i theta_b)| / sum_b r_b``
    over valid bins (``theta_b`` the bin centre): 0 for a flat curve, 1 for activity
    in a single direction.  NaN if fewer than 2 valid bins or ``sum r_b <= 0``
    (so z-scored activity with a negative total gives NaN; use non-negative activity).
    ``"rayleigh_z"`` is ``n * MVL**2`` with ``n`` the total activity summed over valid
    frames (the number of events for ``weight="events"``).  **Caveat:** for a
    continuous trace ``n`` is an amplitude, not an event count, so ``rayleigh_z`` is
    then unit-dependent and not a calibrated Rayleigh statistic; rely on the shuffle p.
    The preferred direction is the argument of the vector, in the input units, in
    ``[0, 360)`` or ``[0, 2 pi)``.

    ``weight="events"`` first binarises activity (``activity > 0``), so the curve is
    the fraction of frames with an event in each bin.

    A 1-D ``bin_grid`` plus ``information_content`` is the linear alternative, but it
    treats 0 and 360 degrees as far apart and cuts a tuning peak that straddles the
    seam in two; MVL uses the vector sum on the circle and has no seam.

    Parameters
    ----------
    units : {"deg", "rad"}, default "deg"
        Units of the angle signal (``head_direction`` writes radians by default; check
        ``session.meta["signal_units"]``).  Angles are wrapped to one turn.
    n_bins : int, default 36
        Number of equal angular bins (>= 2).
    min_occupancy_s : float, default 0.1
        Bins with less masked occupancy (s) are invalid.
    smooth_sigma_bins : float, default 0.0
        Circular Gaussian sigma in bins.
    statistic : {"mvl", "rayleigh_z"}, default "mvl"
        See above.
    weight : {"activity", "events"}, default "activity"
        Use the activity as given, or its binarisation (``> 0``).

    Returns
    -------
    numpy.ndarray
        ``compute`` returns shape ``(n_cells,)``.

    Notes
    -----
    **Tail.**  ``"upper"``: a larger vector length means sharper directional tuning.

    **Null.**  Circular shift of activity against the fixed angle signal; ``compute_shifted``
    is exact and vectorised (activity times a bin one-hot matrix per shift).

    **State space.**  Not applicable: the target is a single 1-D angle signal.

    Extras: ``tuning_curve`` ``(n_cells, n_bins)`` (NaN in invalid bins), ``bin_centers``
    ``(n_bins,)`` in input units, ``preferred_direction`` ``(n_cells,)`` in input units,
    ``mvl`` ``(n_cells,)``, ``occupancy_s`` ``(n_bins,)``, ``valid_bins`` ``(n_bins,)``.
    """

    name: ClassVar[str] = "circular_tuning"
    level: ClassVar[Literal["cell", "population"]] = "cell"
    input: ClassVar[Literal["states", "signal"]] = "signal"
    default_tail: ClassVar[Tail] = "upper"
    default_plots: ClassVar[tuple[str, ...]] = (
        "circular_tuning",
        "metric_strip",
        "shuffle_distribution",
    )

    units: Literal["deg", "rad"] = Field("deg", description="Units of the angle signal.")
    n_bins: int = Field(36, ge=2, description="Number of equal angular bins.")
    min_occupancy_s: float = Field(
        0.1, ge=0, description="Minimum masked occupancy (s) for a bin to be valid."
    )
    smooth_sigma_bins: float = Field(
        0.0, ge=0, description="Circular Gaussian smoothing of the tuning curve, in bins."
    )
    statistic: Literal["mvl", "rayleigh_z"] = Field(
        "mvl", description="Mean vector length, or n * MVL**2 (Rayleigh z)."
    )
    weight: Literal["activity", "events"] = Field(
        "activity", description="Raw activity, or its binarisation (activity > 0)."
    )

    # -- helpers ---------------------------------------------------------- #

    @property
    def _period(self) -> float:
        return 360.0 if self.units == "deg" else 2.0 * np.pi

    def _centers_rad(self) -> np.ndarray:
        return (np.arange(self.n_bins) + 0.5) * 2.0 * np.pi / self.n_bins

    def _setup(self, activity, target, mask):
        self.check_target(target)
        ang = _as_1d(target, self.name)
        act = np.asarray(activity, dtype=np.float64)
        if self.weight == "events":
            act = (act > 0).astype(np.float64)
        ok = np.asarray(mask, dtype=bool) & np.isfinite(ang)
        frac = np.mod(np.where(ok, ang, 0.0), self._period) / self._period
        b = np.minimum((frac * self.n_bins).astype(np.int64), self.n_bins - 1)
        onehot = np.zeros((ang.size, self.n_bins))
        idx = np.flatnonzero(ok)
        onehot[idx, b[idx]] = 1.0
        return act, onehot

    def _curve(self, sums, occ_frames, fs):
        """Mean activity per bin ``(..., n_bins)``, validity ``(n_bins,)`` (smoothed if asked)."""
        valid = occ_frames / fs >= self.min_occupancy_s
        valid &= occ_frames > 0
        with np.errstate(invalid="ignore", divide="ignore"):
            rate = np.where(valid, sums / np.where(occ_frames > 0, occ_frames, 1.0), 0.0)
        if self.smooth_sigma_bins > 0:
            k = _circular_kernel(self.n_bins, self.smooth_sigma_bins)
            v = valid.astype(np.float64)
            den = v @ k
            with np.errstate(invalid="ignore", divide="ignore"):
                rate = (rate * v) @ k / np.where(den > 0, den, 1.0)
            rate = np.where(valid, rate, 0.0)
        return rate, valid

    def _vector(self, rate, valid):
        """``(mvl, preferred_rad, total)`` over the last axis; NaN when undefined."""
        c = self._centers_rad()
        r = np.where(valid, rate, 0.0)
        total = r.sum(axis=-1)
        z = r @ np.exp(1j * c)
        with np.errstate(invalid="ignore", divide="ignore"):
            mvl = np.abs(z) / total
        bad = (valid.sum() < 2) | ~(total > 0)
        mvl = np.where(bad, np.nan, mvl)
        pref = np.where(bad, np.nan, np.mod(np.angle(z), 2.0 * np.pi))
        return mvl, pref

    def _stat(self, sums, occ_frames, fs):
        rate, valid = self._curve(sums, occ_frames, fs)
        mvl, _ = self._vector(rate, valid)
        if self.statistic == "mvl":
            return mvl
        n = np.where(valid, sums, 0.0).sum(axis=-1)
        return n * mvl**2

    # -- Metric contract -------------------------------------------------- #

    def compute(self, activity, target, mask, fs):
        act, onehot = self._setup(activity, target, mask)
        return self._stat(act @ onehot, onehot.sum(axis=0), fs)

    def compute_shifted(self, activity, target, mask, fs, shifts):
        act, onehot = self._setup(activity, target, mask)
        sums = shifted_sums(act, onehot, np.asarray(shifts, dtype=np.int64))
        return self._stat(sums, onehot.sum(axis=0), fs)

    def extras(self, activity, target, mask, fs):
        act, onehot = self._setup(activity, target, mask)
        occ = onehot.sum(axis=0)
        rate, valid = self._curve(act @ onehot, occ, fs)
        mvl, pref = self._vector(rate, valid)
        scale = self._period / (2.0 * np.pi)
        return {
            "tuning_curve": np.where(valid, rate, np.nan),
            "bin_centers": self._centers_rad() * scale,
            "preferred_direction": pref * scale,
            "mvl": mvl,
            "occupancy_s": occ / fs,
            "valid_bins": valid,
        }


__all__ = ["CircularTuning"]
